package httpapi

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestJSONBoundary(t *testing.T) {
	for _, tt := range []struct {
		name, body, media, encoding string
		want                        int
	}{
		{"valid", `{"token":"x"}`, "application/json", "", 200},
		{"duplicate", `{"token":"x","token":"y"}`, "application/json", "", 400},
		{"trailing", `{"token":"x"}{}`, "application/json", "", 400},
		{"unknown", `{"other":true}`, "application/json", "", 400},
		{"large", strings.Repeat("x", 8193), "application/json", "", 413},
		{"media", `{}`, "text/plain", "", 415},
		{"encoding", `{}`, "application/json", "gzip", 415},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(tt.body))
			r.Header.Set("Content-Type", tt.media)
			r.Header.Set("Content-Encoding", tt.encoding)
			w := httptest.NewRecorder()
			var body struct {
				Token string `json:"token"`
			}
			decode(w, r, &body)
			if w.Code != tt.want {
				t.Fatalf("status=%d want=%d", w.Code, tt.want)
			}
		})
	}
}
func TestGuestHTTPAndForcedDisconnect(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	admin, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := pgx.Identifier{"http_" + uuid.New().String()}.Sanitize()
	if _, err = admin.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &community.Store{Pool: pool}
	if err = store.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = store.Setup(t.Context(), "Test", "owner", func(context.Context) (string, error) { return "subject", nil }); err != nil {
		t.Fatal(err)
	}
	owner, err := store.AccountIdentity(t.Context(), "subject")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := store.Invite(t.Context(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	const origin = "http://localhost:5173"
	api, err := NewCommunity(store, nil, nil, CommunityConfig{Origin: origin, SetupToken: strings.Repeat("a", 64), SetupExpires: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	server := httptest.NewServer(api)
	defer server.Close()
	request := func(path string, body any, cookie *http.Cookie, requestOrigin string) (*http.Response, []byte) {
		t.Helper()
		data, e := json.Marshal(body)
		if e != nil {
			t.Fatal(e)
		}
		r, e := http.NewRequestWithContext(t.Context(), "POST", server.URL+path, bytes.NewReader(data))
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", requestOrigin)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var buf bytes.Buffer
		if _, e = buf.ReadFrom(res.Body); e != nil {
			t.Fatal(e)
		}
		return res, buf.Bytes()
	}
	res, _ := request("/api/v1/guests", map[string]string{"nickname": "friend", "invitation": invite}, nil, "https://evil.invalid")
	if res.StatusCode != 403 {
		t.Fatal("cross-origin admission accepted")
	}
	res, data := request("/api/v1/guests", map[string]string{"nickname": "friend", "invitation": invite}, nil, origin)
	if res.StatusCode != 201 {
		t.Fatalf("join=%d %s", res.StatusCode, data)
	}
	var participant community.Participant
	if err = json.Unmarshal(data, &participant); err != nil {
		t.Fatal(err)
	}
	cookies := res.Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("invalid credential cookie")
	}
	cookie := cookies[0]
	res, _ = request("/api/v1/invitations", map[string]string{}, cookie, origin)
	if res.StatusCode != 403 {
		t.Fatal("guest accessed owner endpoint")
	}
	res, data = request("/api/v1/events/ticket", map[string]string{}, cookie, origin)
	if res.StatusCode != 201 {
		t.Fatal("ticket denied")
	}
	var issued struct {
		Ticket string `json:"ticket"`
	}
	if err = json.Unmarshal(data, &issued); err != nil {
		t.Fatal(err)
	}
	header := http.Header{"Origin": []string{origin}}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/events", &websocket.DialOptions{HTTPHeader: header, Subprotocols: []string{"yapper.v1", "yapper.ticket." + issued.Ticket}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if _, _, err = ws.Read(ctx); err != nil {
		t.Fatal("no ready event", err)
	}
	replay, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/events", &websocket.DialOptions{HTTPHeader: header, Subprotocols: []string{"yapper.v1", "yapper.ticket." + issued.Ticket}})
	if err == nil {
		replay.CloseNow()
		t.Fatal("ticket replay accepted")
	}
	if err = store.Ban(t.Context(), owner.ID, participant.ID); err != nil {
		t.Fatal(err)
	}
	api.disconnect(participant.ID)
	if _, _, err = ws.Read(ctx); err == nil {
		t.Fatal("banned socket remained open")
	}
	res, _ = request("/api/v1/events/ticket", map[string]string{}, cookie, origin)
	if res.StatusCode != 403 {
		t.Fatal("banned credential reconnected")
	}
}
