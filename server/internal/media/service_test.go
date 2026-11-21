package media

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"uuid"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/MrDeex1k/Yapper/server/internal/identity"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/proto"
)

func TestSelfHostedReplayGate(t *testing.T) {
	dsn, endpoint := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_LIVEKIT_URL")
	if dsn == "" || endpoint == "" {
		t.Skip("TEST_DATABASE_URL and TEST_LIVEKIT_URL required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := pgx.Identifier{"media_" + uuid.New().String()}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &community.Store{Pool: pool}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = store.Setup(ctx, "Test", "owner", func(context.Context) (string, error) { return "owner", nil }); err != nil {
		t.Fatal(err)
	}
	owner, err := store.AccountIdentity(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := store.Invite(ctx, owner.ID, community.InvitationOptions{ExpiresInHours: 24, MaxUses: 1})
	if err != nil {
		t.Fatal(err)
	}
	guest, _, err := store.Guest(ctx, "friend", invite, netip.Addr{})
	if err != nil {
		t.Fatal(err)
	}
	channels, err := store.Channels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var channel string
	for _, c := range channels {
		if c.Kind == "voice" {
			channel = c.ID
		}
	}
	const origin = "http://localhost:5173"
	service, err := New(store, nil, endpoint, os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"), origin)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	proxy := httptest.NewServer(service)
	defer proxy.Close()
	grant, err := service.Grant(ctx, guest, channel, "", "", "")
	if err != nil {
		t.Fatal("grant failed", err)
	}
	address := "ws" + strings.TrimPrefix(proxy.URL, "http") + "/livekit/rtc?access_token=" + url.QueryEscape(grant.Token) + "&protocol=15&auto_subscribe=1"
	header := http.Header{"Origin": []string{origin}}
	connection, _, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		t.Fatal("LiveKit signaling handshake failed")
	}
	defer connection.CloseNow()
	if _, _, err = connection.Read(ctx); err != nil {
		t.Fatal("LiveKit did not send join response")
	}
	if _, err = store.Moderate(ctx, owner.ID, guest.ID, community.Ban, false); err != nil {
		t.Fatal(err)
	}
	if err = service.Revoke(ctx, guest.ID); err != nil {
		t.Fatal("media removal failed", err)
	}
	closed, cancelClose := context.WithTimeout(ctx, 2*time.Second)
	for {
		_, _, readErr := connection.Read(closed)
		if readErr != nil {
			if closed.Err() != nil {
				t.Fatal("revoked signaling did not close promptly")
			}
			break
		}
	}
	cancelClose()
	if _, err = service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: grant.Identity}); err == nil {
		t.Fatal("revoked participant remains in LiveKit")
	}

	replay, response, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: header})
	if err == nil {
		replay.CloseNow()
		t.Fatal("revoked grant replay succeeded")
	}
	if response == nil || response.StatusCode != 403 {
		t.Fatal("replay was not rejected at admission")
	}
	if _, err = service.Grant(ctx, guest, channel, "", "", ""); err == nil {
		t.Fatal("banned participant obtained a new grant")
	}
	// Verify the premise against the pinned real server: its private endpoint
	// still accepts the old token. Production must not publish this endpoint.
	direct := "ws" + strings.TrimPrefix(endpoint, "http") + "/rtc?access_token=" + url.QueryEscape(grant.Token) + "&protocol=15&auto_subscribe=1"
	bypass, _, err := websocket.Dial(ctx, direct, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		t.Fatal("expected pinned self-hosted token behavior changed; review gate")
	}
	defer bypass.CloseNow()
	if _, _, err = bypass.Read(ctx); err != nil {
		t.Fatal("private server did not accept reused token")
	}
	if _, err = service.room.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: grant.Identity}); err != nil {
		t.Fatal("cleanup failed", err)
	}

	t.Run("registered session survives AUTH outage but not revocation", func(t *testing.T) {
		var active atomic.Bool
		var unavailable atomic.Bool
		active.Store(true)
		authHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if unavailable.Load() {
				w.WriteHeader(503)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if active.Load() {
				_, _ = w.Write([]byte(`{"active":true}`))
			} else {
				_, _ = w.Write([]byte(`{"active":false}`))
			}
		}))
		defer authHTTP.Close()
		auth, err := identity.NewAuthClient(authHTTP.URL, strings.Repeat("s", 32))
		if err != nil {
			t.Fatal(err)
		}
		registered, err := New(store, auth, endpoint, os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"), origin)
		if err != nil {
			t.Fatal(err)
		}
		defer registered.Close()
		ownerGrant, err := registered.Grant(ctx, owner, channel, "owner", "session", "")
		if err != nil {
			t.Fatal(err)
		}
		ownerProxy := httptest.NewServer(registered)
		defer ownerProxy.Close()
		ownerAddress := "ws" + strings.TrimPrefix(ownerProxy.URL, "http") + "/livekit/rtc?access_token=" + url.QueryEscape(ownerGrant.Token) + "&protocol=15"
		voice, _, err := websocket.Dial(ctx, ownerAddress, &websocket.DialOptions{HTTPHeader: header})
		if err != nil {
			t.Fatal(err)
		}
		defer voice.CloseNow()
		if _, _, err := voice.Read(ctx); err != nil {
			t.Fatal(err)
		}
		unavailable.Store(true)
		registered.reconcileOnce(ctx)
		if _, err := store.VoiceSession(ctx, ownerGrant.Identity); err != nil {
			t.Fatal("AUTH outage revoked stored session", err)
		}
		if _, err := registered.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: ownerGrant.Identity}); err != nil {
			t.Fatal("AUTH outage removed active voice", err)
		}
		unavailable.Store(false)
		active.Store(false)
		registered.reconcileOnce(ctx)
		if _, err := store.VoiceSession(ctx, ownerGrant.Identity); !errors.Is(err, community.ErrDenied) {
			t.Fatal("revoked account retained voice")
		}
		if _, err := registered.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: ownerGrant.Identity}); err == nil {
			t.Fatal("revoked account remains in LiveKit")
		}
		denied, response, err := websocket.Dial(ctx, ownerAddress, &websocket.DialOptions{HTTPHeader: header})
		if err == nil {
			denied.CloseNow()
			t.Fatal("revoked account token replay succeeded")
		}
		if response == nil || response.StatusCode != 403 {
			t.Fatal("revoked account replay was not denied")
		}
	})
	t.Run("switching rooms removes the old identity before admitting its replacement", func(t *testing.T) {
		invitation, err := store.Invite(ctx, owner.ID, community.InvitationOptions{MaxUses: 1})
		if err != nil {
			t.Fatal(err)
		}
		switcher, _, err := store.Guest(ctx, "switcher", invitation, netip.Addr{})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.SaveChannel(ctx, owner.ID, "", "Second voice", "voice", ""); err != nil {
			t.Fatal(err)
		}
		channels, err := store.Channels(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var nextChannel string
		for _, item := range channels {
			if item.Name == "Second voice" {
				nextChannel = item.ID
			}
		}
		connect := func(grant Grant) (*websocket.Conn, *http.Response, error) {
			address := "ws" + strings.TrimPrefix(proxy.URL, "http") + "/livekit/rtc?protocol=15&access_token=" + url.QueryEscape(grant.Token)
			return websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: header})
		}
		enter := func(channelID string) Grant {
			t.Helper()
			grant, err := service.Grant(ctx, switcher, channelID, "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			ws, _, err := connect(grant)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = ws.CloseNow() })
			if _, _, err := ws.Read(ctx); err != nil {
				t.Fatal(err)
			}
			return grant
		}
		previous := enter(channel)
		if _, err := service.Grant(ctx, switcher, nextChannel, "", "", previous.Identity); !errors.Is(err, community.ErrDenied) {
			t.Fatalf("automatic recovery switched rooms: %v", err)
		}

		replacement := enter(nextChannel)
		if _, err := service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: previous.Identity}); err == nil {
			t.Fatal("old room still held the switched participant")
		}
		if replay, res, err := connect(previous); err == nil || res == nil || res.StatusCode != 403 {
			if replay != nil {
				_ = replay.CloseNow()
			}
			t.Fatalf("old grant was not rejected: %v", err)
		}
		if err := service.Leave(ctx, switcher.ID, previous.Identity); err != nil {
			t.Fatal(err)
		}
		if m, err := store.VoiceSession(ctx, replacement.Identity); err != nil || m.ChannelID != nextChannel {
			t.Fatalf("stale leave changed the replacement grant: %+v %v", m, err)
		}
		if _, err := service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: nextChannel, Identity: replacement.Identity}); err != nil {
			t.Fatal("replacement missing in LiveKit", err)
		}
		recovered, err := service.Grant(ctx, switcher, nextChannel, "", "", replacement.Identity)
		if err != nil || recovered.Identity == replacement.Identity {
			t.Fatalf("automatic recovery did not rotate the media grant: %+v %v", recovered, err)
		}
		if _, err := service.Grant(ctx, switcher, nextChannel, "", "", replacement.Identity); !errors.Is(err, community.ErrDenied) {
			t.Fatalf("replaced media identity authorized automatic recovery: %v", err)
		}
		if err := service.Leave(ctx, switcher.ID, recovered.Identity); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("force mute removes the publishing session and preserves listen access", func(t *testing.T) {
		invite, err := store.Invite(ctx, owner.ID, community.InvitationOptions{MaxUses: 1})
		if err != nil {
			t.Fatal(err)
		}
		speaker, _, err := store.Guest(ctx, "speaker", invite, netip.Addr{})
		if err != nil {
			t.Fatal(err)
		}
		dial := func(grant Grant) (*websocket.Conn, *http.Response, error) {
			address := "ws" + strings.TrimPrefix(proxy.URL, "http") + "/livekit/rtc?access_token=" + url.QueryEscape(grant.Token) + "&protocol=15&auto_subscribe=1"
			return websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: header})
		}
		join := func(grant Grant, publish bool) *websocket.Conn {
			t.Helper()
			ws, _, err := dial(grant)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = ws.CloseNow() })
			if _, _, err := ws.Read(ctx); err != nil {
				t.Fatal("join response:", err)
			}
			member, err := service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: grant.Identity})
			if err != nil || member.GetPermission().GetCanPublish() != publish || !member.GetPermission().GetCanSubscribe() {
				t.Fatalf("LiveKit join permissions=%v, err=%v, publish wanted=%v", member.GetPermission(), err, publish)
			}
			return ws
		}
		grantFor := func(publish bool) Grant {
			t.Helper()
			grant, err := service.Grant(ctx, speaker, channel, "", "", "")
			if err != nil || grant.CanPublish != publish {
				t.Fatalf("grant permission=%v err=%v, publish wanted=%v", grant.CanPublish, err, publish)
			}
			return grant
		}
		apply := func(action community.ModerationAction) {
			t.Helper()
			sessions, err := store.Moderate(ctx, owner.ID, speaker.ID, action, false)
			if err != nil || len(sessions) != 1 {
				t.Fatalf("revocations=%d err=%v", len(sessions), err)
			}
			service.FinishRevocations(ctx, sessions)
		}
		requestTrack := func(ws *websocket.Conn, wait time.Duration) bool {
			t.Helper()
			probe, cancel := context.WithTimeout(ctx, wait)
			defer cancel()
			data, err := proto.Marshal(&livekit.SignalRequest{Message: &livekit.SignalRequest_AddTrack{
				AddTrack: &livekit.AddTrackRequest{Cid: "test-mic", Name: "test-mic", Type: livekit.TrackType_AUDIO, Source: livekit.TrackSource_MICROPHONE},
			}})
			if err != nil {
				t.Fatal(err)
			}
			if err := ws.Write(probe, websocket.MessageBinary, data); err != nil {
				t.Fatal(err)
			}
			for {
				_, data, err := ws.Read(probe)
				if err != nil {
					return false
				}
				var response livekit.SignalResponse
				if proto.Unmarshal(data, &response) == nil && response.GetTrackPublished() != nil {
					return true
				}
			}
		}
		before := grantFor(true)
		active := join(before, true)
		if !requestTrack(active, 2*time.Second) {
			t.Fatal("control publication was not accepted")
		}
		apply(community.Mute)
		if _, err := service.Grant(ctx, speaker, channel, "", "", before.Identity); !errors.Is(err, community.ErrDenied) {
			t.Fatalf("moderated grant authorized automatic recovery: %v", err)
		}
		if _, err := service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: before.Identity}); err == nil {
			t.Fatal("forced mute left the old publisher active")
		}
		if replay, response, err := dial(before); err == nil || response == nil || response.StatusCode != 403 {
			if replay != nil {
				_ = replay.CloseNow()
			}
			t.Fatalf("forced mute did not deny old publishing grant: %v", err)
		}
		listener := join(grantFor(false), false)
		if requestTrack(listener, 750*time.Millisecond) {
			t.Fatal("LiveKit accepted a microphone track from a listen-only participant")
		}
		apply(community.Unmute)
		restored := grantFor(true)
		join(restored, true)
		if err := store.ArchiveChannel(ctx, owner.ID, channel); err != nil {
			t.Fatal(err)
		}
		service.reconcileOnce(ctx)
		if _, err := service.room.GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: channel, Identity: restored.Identity}); err == nil {
			t.Fatal("archived voice channel retained an active participant")
		}
		if _, err := service.Grant(ctx, speaker, channel, "", "", ""); !errors.Is(err, community.ErrDenied) {
			t.Fatalf("archived channel admitted a grant: %v", err)
		}
	})
	t.Log("Real LiveKit accepts a revoked token directly; Yapper ingress rejects it and closes the previous connection.")
}
