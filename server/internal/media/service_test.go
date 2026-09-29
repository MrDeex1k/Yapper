package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/livekit"
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
	invite, err := store.Invite(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	guest, _, err := store.Guest(ctx, "friend", invite)
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
	grant, err := service.Grant(ctx, guest.ID, channel, "", "")
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
	if err = store.Ban(ctx, owner.ID, guest.ID); err != nil {
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
	if _, err = service.Grant(ctx, guest.ID, channel, "", ""); err == nil {
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
	t.Log("Real LiveKit accepts a revoked token directly; Yapper ingress rejects it and closes the previous connection.")
}
