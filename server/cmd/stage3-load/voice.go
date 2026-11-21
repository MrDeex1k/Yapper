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
	"sync/atomic"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
)

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
}

type voiceBridge struct {
	address   string
	close     func()
	sessions  [20]*voiceClient
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

func (v *voiceBridge) connect(ctx context.Context, index int, guest *client, channel, tone, resume string) error {
	var media grant
	body := map[string]string{"channelId": channel, "resumeIdentity": resume}
	if err := guest.request(ctx, "/api/v1/voice/grant", body, 201, &media); err != nil {
		return err
	}
	expectedURL := "ws" + strings.TrimPrefix(guest.origin, "http") + "/livekit"
	if !media.CanPublish || media.ChannelID != channel || media.Token == "" ||
		media.URL != expectedURL || media.Identity == "" || media.Identity == resume {
		return errors.New("unexpected media grant")
	}

	callbacks := lksdk.NewRoomCallback()
	callbacks.OnTrackSubscribed = func(track *webrtc.TrackRemote, _ *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) {
		go v.receive(track)
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
	v.sessions[index] = &voiceClient{guest: guest, room: room, track: track, identity: media.Identity}
	return nil
}

func (v *voiceBridge) leaveAll(ctx context.Context) {
	for _, session := range v.sessions {
		if session == nil {
			continue
		}
		session.room.Disconnect()
		_ = session.track.Close()
		_ = session.guest.request(ctx, "/api/v1/voice/leave", map[string]string{"identity": session.identity}, 200, nil)
	}
}

func (v *voiceBridge) verify() error {
	for i, session := range v.sessions {
		if count := len(session.room.GetRemoteParticipants()); count != 9 {
			return fmt.Errorf("voice participant %d saw %d peers, expected 9", i+1, count)
		}
	}
	packets := v.packets.Load()
	if packets == 0 {
		return errors.New("no WebRTC audio was received")
	}
	samples := v.samples.Load()
	meanVariation := time.Duration(v.jitterSum.Load()/max(samples, 1)) * time.Microsecond
	fmt.Printf("RTP packets received=%d; forward sequence gaps=%d; mean arrival variation=%s\n", packets, v.gaps.Load(), meanVariation)
	return nil
}

func (v *voiceBridge) receive(track *webrtc.TrackRemote) {
	var lastSequence uint16
	var lastTimestamp uint32
	var lastArrival time.Time
	for {
		packet, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		now := time.Now()
		v.packets.Add(1)
		if !lastArrival.IsZero() {
			if delta := packet.SequenceNumber - lastSequence; delta > 0 && delta < 0x8000 {
				v.gaps.Add(uint64(delta - 1))
				interval := time.Second * time.Duration(packet.Timestamp-lastTimestamp) / 48000
				variation := now.Sub(lastArrival) - interval
				if variation < 0 {
					variation = -variation
				}
				v.jitterSum.Add(uint64(variation.Microseconds()))
				v.samples.Add(1)
			}
		}
		lastArrival = now
		lastSequence = packet.SequenceNumber
		lastTimestamp = packet.Timestamp
	}
}
