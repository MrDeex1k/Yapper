package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/livekit/server-sdk-go/v2/pkg/oggreader"
	"github.com/pion/webrtc/v4"
)

const voiceRoomSize = 10
const voiceClients = 2 * voiceRoomSize

type grant struct {
	URL        string `json:"url"`
	Token      string `json:"token"`
	Identity   string `json:"identity"`
	ChannelID  string `json:"channelId"`
	CanPublish bool   `json:"canPublish"`
}

type voiceClient struct {
	guest    *client
	room     *lksdk.Room
	track    *lksdk.LocalTrack
	identity string
	mu       sync.Mutex
	incoming map[string]*atomic.Uint64
}

type voiceBridge struct {
	address   string
	close     func()
	sessions  [voiceClients]*voiceClient
	metricsMu sync.Mutex
	metrics   rtpMetrics
}

func validateTone(path string) error {
	if filepath.Ext(path) != ".ogg" {
		return errors.New("the test tone must be an Ogg Opus file (.ogg)")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("the test tone must be a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	source := bufio.NewReader(file)
	reader, _, err := oggreader.NewOggReader(source)
	if err != nil {
		return err
	}
	// The SDK reads OpusHead and skips its comment page during construction.
	// Reject an empty audio page before ReadPacket indexes its segment table.
	page, err := source.Peek(27)
	if err != nil {
		return fmt.Errorf("read first Ogg audio page: %w", err)
	}
	if !bytes.HasPrefix(page, []byte("OggS")) || page[26] == 0 {
		return errors.New("the test tone has an invalid first Ogg audio page")
	}
	packet, err := reader.ReadPacket()
	if err != nil {
		return fmt.Errorf("read first audio packet: %w", err)
	}
	if len(packet) == 0 || bytes.HasPrefix(packet, []byte("OpusTags")) {
		return errors.New("the test tone has no first audio packet")
	}
	return nil
}

func startVoiceBridge(ctx context.Context, origin string) (*voiceBridge, error) {
	target, err := url.Parse(origin)
	if err != nil {
		return nil, err
	}
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	proxy := &httputil.ReverseProxy{Rewrite: func(request *httputil.ProxyRequest) {
		request.SetURL(target)
		request.Out.Header.Set("Origin", origin)
		// The SDK sends the same grant in an Authorization header. Go's media
		// ingress expects the access_token query used by the browser client.
		if token, ok := strings.CutPrefix(request.In.Header.Get("Authorization"), "Bearer "); ok {
			query := request.Out.URL.Query()
			query.Set("access_token", token)
			request.Out.URL.RawQuery = query.Encode()
		}
		request.Out.Header.Del("Authorization")
	}}
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/livekit/rtc", "/livekit/rtc/validate", "/livekit/rtc/v1", "/livekit/rtc/v1/validate":
				proxy.ServeHTTP(w, r)
			default:
				http.NotFound(w, r)
			}
		}),
	}
	go func() { _ = server.Serve(listener) }()
	return &voiceBridge{
		address: "http://" + listener.Addr().String() + "/livekit",
		close:   func() { _ = server.Close() },
	}, nil
}

func (v *voiceBridge) join(ctx context.Context, index int, guest *client, channel, tone string) error {
	return v.connect(ctx, index, guest, channel, tone, "")
}

func (v *voiceBridge) replace(ctx context.Context, index int, guest *client, channel, tone string) error {
	previous := v.sessions[index]
	previous.room.Disconnect()
	_ = previous.track.Close()
	if err := v.connect(ctx, index, guest, channel, tone, previous.identity); err != nil {
		return err
	}
	return v.awaitReplacementRTP(ctx, index)
}

func (v *voiceBridge) connect(ctx context.Context, index int, guest *client, channel, tone, resume string) (connectErr error) {
	var media grant
	var cleanupIdentity string
	defer func() {
		if connectErr != nil {
			// A lost response can leave a committed grant with no known identity.
			// An empty identity revokes the disposable guest's current grant.
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 8*time.Second)
			defer cancel()
			connectErr = errors.Join(connectErr, guest.releaseVoice(cleanup, cleanupIdentity))
		}
	}()
	body := map[string]string{"channelId": channel, "resumeIdentity": resume}
	if err := guest.request(ctx, "/api/v1/voice/grant", body, 201, &media); err != nil {
		return err
	}
	if media.Identity != resume {
		cleanupIdentity = media.Identity
	}
	expectedURL := "ws" + strings.TrimPrefix(guest.origin, "http") + "/livekit"
	if !media.CanPublish || media.ChannelID != channel || media.Token == "" ||
		media.URL != expectedURL || media.Identity == "" || media.Identity == resume {
		return errors.New("unexpected media grant")
	}

	session := &voiceClient{guest: guest, identity: media.Identity, incoming: make(map[string]*atomic.Uint64)}
	callbacks := lksdk.NewRoomCallback()
	callbacks.OnTrackSubscribed = func(track *webrtc.TrackRemote, _ *lksdk.RemoteTrackPublication, participant *lksdk.RemoteParticipant) {
		go v.receive(track, session.counter(participant.Identity()))
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	connectTimeout := 8 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		connectTimeout = min(connectTimeout, time.Until(deadline))
	}
	room, err := lksdk.ConnectToRoomWithToken(v.address, media.Token, callbacks, lksdk.WithConnectTimeout(connectTimeout))
	if err != nil {
		return fmt.Errorf("connect LiveKit session: %w", err)
	}
	track, err := lksdk.NewLocalFileTrack(tone)
	if err != nil {
		room.Disconnect()
		return err
	}
	if _, err := room.LocalParticipant.PublishTrack(track, &lksdk.TrackPublicationOptions{
		Name: "synthetic-audio", Source: livekit.TrackSource_MICROPHONE,
	}); err != nil {
		_ = track.Close()
		room.Disconnect()
		return fmt.Errorf("publish synthetic audio: %w", err)
	}
	session.room, session.track = room, track
	v.sessions[index] = session
	return nil
}

func (v *voiceBridge) awaitReplacementRTP(ctx context.Context, index int) error {
	replacement := v.sessions[index]
	start := index / voiceRoomSize * voiceRoomSize
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("voice participant %d did not exchange fresh RTP with every room peer: %w", index+1, err)
		}
		complete := true
		for _, peer := range v.sessions[start : start+voiceRoomSize] {
			if peer != replacement && (replacement.counter(peer.identity).Load() == 0 ||
				peer.counter(replacement.identity).Load() == 0) {
				complete = false
				break
			}
		}
		if complete {
			return nil
		}
		select {
		case <-ctx.Done():
		case <-tick.C:
		}
	}
}

func (c *client) releaseVoice(ctx context.Context, identity string) error {
	return c.request(ctx, "/api/v1/voice/leave", map[string]string{"identity": identity}, 200, nil)
}

func (v *voiceBridge) leaveAll(ctx context.Context) error {
	var failures [voiceClients]error
	var cleanup sync.WaitGroup
	for i, session := range v.sessions {
		if session == nil {
			continue
		}
		cleanup.Go(func() {
			session.room.Disconnect()
			_ = session.track.Close()
			failures[i] = session.guest.releaseVoice(ctx, session.identity)
		})
	}
	cleanup.Wait()
	return errors.Join(failures[:]...)
}

func (c *voiceClient) counter(identity string) *atomic.Uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	counter := c.incoming[identity]
	if counter == nil {
		counter = new(atomic.Uint64)
		c.incoming[identity] = counter
	}
	return counter
}

type voiceCounts [voiceClients][voiceRoomSize]uint64

func (v *voiceBridge) packetCounts() (counts voiceCounts) {
	for receiver, session := range v.sessions {
		start := receiver / voiceRoomSize * voiceRoomSize
		for publisher := range voiceRoomSize {
			if start+publisher == receiver {
				continue
			}
			identity := v.sessions[start+publisher].identity
			counts[receiver][publisher] = session.counter(identity).Load()
		}
	}
	return counts
}

func (v *voiceBridge) verifyProgress(before voiceCounts) error {
	after := v.packetCounts()
	for receiver, packets := range after {
		for publisher, received := range packets {
			if receiver%voiceRoomSize != publisher && received <= before[receiver][publisher] {
				return fmt.Errorf("voice participant %d stopped receiving RTP from room peer %d", receiver+1, publisher+1)
			}
		}
	}
	return nil
}

func (v *voiceBridge) verify(metrics rtpMetrics) error {
	for i, session := range v.sessions {
		if count := len(session.room.GetRemoteParticipants()); count != voiceRoomSize-1 {
			return fmt.Errorf("voice participant %d saw %d peers, expected %d", i+1, count, voiceRoomSize-1)
		}
	}
	fmt.Printf("RTP packets received=%d; forward sequence gaps=%d; mean arrival variation=%s\n",
		metrics.packets, metrics.gaps, metrics.meanVariation())
	return metrics.validate()
}

type rtpMetrics struct {
	packets, gaps, jitterMicros, samples uint64
}

func (v *voiceBridge) snapshot() rtpMetrics {
	v.metricsMu.Lock()
	defer v.metricsMu.Unlock()
	return v.metrics
}

func (m rtpMetrics) since(start rtpMetrics) rtpMetrics {
	return rtpMetrics{
		packets:      m.packets - start.packets,
		gaps:         m.gaps - start.gaps,
		jitterMicros: m.jitterMicros - start.jitterMicros,
		samples:      m.samples - start.samples,
	}
}

func (m rtpMetrics) meanVariation() time.Duration {
	return time.Duration(m.jitterMicros/max(m.samples, 1)) * time.Microsecond
}

func (m rtpMetrics) validate() error {
	if m.packets == 0 {
		return errors.New("no WebRTC audio was received")
	}
	if m.gaps*100 > m.packets+m.gaps || m.meanVariation() > 20*time.Millisecond {
		return errors.New("capacity run exceeded an RTP threshold")
	}
	return nil
}

type rtpArrival struct {
	sequence  uint16
	timestamp uint32
	at        time.Time
}

func (last *rtpArrival) observe(next rtpArrival) (gaps uint16, variation time.Duration, sampled bool) {
	if last.at.IsZero() {
		*last = next
		return 0, 0, false
	}
	delta := next.sequence - last.sequence
	if delta == 0 || delta >= 0x8000 {
		return 0, 0, false
	}
	const opusClockRate = 48000
	interval := time.Second * time.Duration(next.timestamp-last.timestamp) / opusClockRate
	variation = next.at.Sub(last.at) - interval
	if variation < 0 {
		variation = -variation
	}
	*last = next
	return delta - 1, variation, true
}

func (v *voiceBridge) receive(track *webrtc.TrackRemote, incoming *atomic.Uint64) {
	var last rtpArrival
	for {
		packet, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		gaps, variation, sampled := last.observe(rtpArrival{packet.SequenceNumber, packet.Timestamp, time.Now()})
		incoming.Add(1)
		v.metricsMu.Lock()
		v.metrics.packets++
		if sampled {
			v.metrics.gaps += uint64(gaps)
			v.metrics.jitterMicros += uint64(variation.Microseconds())
			v.metrics.samples++
		}
		v.metricsMu.Unlock()
	}
}
