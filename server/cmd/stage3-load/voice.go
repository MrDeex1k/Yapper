package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
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
	packets   atomic.Uint64
	gaps      atomic.Uint64
	jitterSum atomic.Uint64
	samples   atomic.Uint64
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
	return v.connect(ctx, index, guest, channel, tone, previous.identity)
}

func (v *voiceBridge) connect(ctx context.Context, index int, guest *client, channel, tone, resume string) (connectErr error) {
	var media grant
	body := map[string]string{"channelId": channel, "resumeIdentity": resume}
	if err := guest.request(ctx, "/api/v1/voice/grant", body, 201, &media); err != nil {
		return err
	}
	defer func() {
		if connectErr != nil && media.Identity != "" {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 8*time.Second)
			defer cancel()
			connectErr = errors.Join(connectErr, guest.releaseVoice(cleanup, media.Identity))
		}
	}()
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
	room, err := lksdk.ConnectToRoomWithToken(v.address, media.Token, callbacks, lksdk.WithConnectTimeout(8*time.Second))
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

func (v *voiceBridge) verify() error {
	for i, session := range v.sessions {
		if count := len(session.room.GetRemoteParticipants()); count != voiceRoomSize-1 {
			return fmt.Errorf("voice participant %d saw %d peers, expected %d", i+1, count, voiceRoomSize-1)
		}
	}
	packets := v.packets.Load()
	if packets == 0 {
		return errors.New("no WebRTC audio was received")
	}
	samples := v.samples.Load()
	meanVariation := time.Duration(v.jitterSum.Load()/max(samples, 1)) * time.Microsecond
	gaps := v.gaps.Load()
	fmt.Printf("RTP packets received=%d; forward sequence gaps=%d; mean arrival variation=%s\n", packets, gaps, meanVariation)
	if gaps*100 > packets+gaps || meanVariation > 20*time.Millisecond {
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
		v.packets.Add(1)
		if sampled {
			v.gaps.Add(uint64(gaps))
			v.jitterSum.Add(uint64(variation.Microseconds()))
			v.samples.Add(1)
		}
	}
}
