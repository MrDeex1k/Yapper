// media-smoke verifies local two-participant RTP delivery; it does not test audio quality.
package main

import (
	"context"
	"fmt"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"os"
	"time"
)

func run() error {
	url, key, secret := os.Getenv("LIVEKIT_URL"), os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET")
	if url == "" || key == "" || secret == "" {
		return fmt.Errorf("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET required")
	}
	roomName := fmt.Sprintf("smoke-%d", time.Now().UnixNano())
	received := make(chan struct{}, 1)
	cb := lksdk.NewRoomCallback()
	cb.OnTrackSubscribed = func(track *webrtc.TrackRemote, _ *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) {
		go func() {
			if _, _, err := track.ReadRTP(); err == nil {
				select {
				case received <- struct{}{}:
				default:
				}
			}
		}()
	}
	receiver, err := lksdk.ConnectToRoom(url, lksdk.ConnectInfo{APIKey: key, APISecret: secret, RoomName: roomName, ParticipantIdentity: "receiver"}, cb)
	if err != nil {
		return err
	}
	defer receiver.Disconnect()
	sender, err := lksdk.ConnectToRoom(url, lksdk.ConnectInfo{APIKey: key, APISecret: secret, RoomName: roomName, ParticipantIdentity: "sender"}, nil)
	if err != nil {
		return err
	}
	defer sender.Disconnect()
	track, err := lksdk.NewLocalSampleTrack(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2})
	if err != nil {
		return err
	}
	defer track.Close()
	if _, err = sender.LocalParticipant.PublishTrack(track, &lksdk.TrackPublicationOptions{Name: "smoke-opus"}); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-received:
			fmt.Println("PASS: two LiveKit participants connected and Opus RTP reached the receiver")
			return nil
		case <-ctx.Done():
			return fmt.Errorf("no RTP received within 20 seconds")
		case <-ticker.C:
			if err = track.WriteSample(media.Sample{Data: []byte{0xf8, 0xff, 0xfe}, Duration: 20 * time.Millisecond}, nil); err != nil {
				return err
			}
		}
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
