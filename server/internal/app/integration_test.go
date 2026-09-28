package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL required for PostgreSQL integration tests")
	}
	admin, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	raw := make([]byte, 8)
	_, _ = rand.Read(raw)
	schema := "test_" + hex.EncodeToString(raw)
	if _, err = admin.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	conf, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	conf.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), conf)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}
func testServer(t *testing.T) *Server {
	t.Helper()
	pool := testDatabase(t)
	if err := Migrate(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(t.Context(), pool); err != nil {
		t.Fatal("migration was not idempotent", err)
	}
	s := NewServer()
	s.DB = pool
	s.BootstrapToken = "test-bootstrap-only"
	return s
}
func request(t *testing.T, s *Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	result := map[string]any{}
	if w.Body.Len() > 0 {
		if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(w.Body.String())
		}
	}
	return w.Code, result
}
func adminSession(t *testing.T, s *Server) string {
	t.Helper()
	status, result := request(t, s, "POST", "/api/v1/auth/bootstrap", "", map[string]string{"username": "admin", "password": "test-password-strong", "token": s.BootstrapToken})
	if status != 201 {
		t.Fatalf("bootstrap %d %v", status, result)
	}
	status, result = request(t, s, "POST", "/api/v1/auth/login", "", map[string]string{"username": "admin", "password": "test-password-strong"})
	if status != 200 {
		t.Fatalf("login %d %v", status, result)
	}
	return result["token"].(string)
}
func TestAuthLifecycle(t *testing.T) {
	s := testServer(t)
	token := adminSession(t, s)
	status, _ := request(t, s, "POST", "/api/v1/auth/bootstrap", "", map[string]string{"username": "other", "password": "test-password-strong", "token": s.BootstrapToken})
	if status != 409 {
		t.Fatalf("second bootstrap: %d", status)
	}
	status, result := request(t, s, "POST", "/api/v1/auth/invites", token, nil)
	if status != 201 {
		t.Fatalf("invite: %d", status)
	}
	body := map[string]string{"username": "member", "password": "test-password-strong", "invite": result["invite"].(string)}
	status, result = request(t, s, "POST", "/api/v1/auth/register", "", body)
	if status != 200 {
		t.Fatalf("register: %d %v", status, result)
	}
	memberToken := result["token"].(string)
	body["username"] = "second"
	status, _ = request(t, s, "POST", "/api/v1/auth/register", "", body)
	if status != 400 {
		t.Fatalf("invite reuse: %d", status)
	}
	status, _ = request(t, s, "POST", "/api/v1/auth/invites", memberToken, nil)
	if status != 403 {
		t.Fatalf("member invite: %d", status)
	}
	status, _ = request(t, s, "POST", "/api/v1/auth/logout", memberToken, nil)
	if status != 204 {
		t.Fatalf("logout: %d", status)
	}
	status, _ = request(t, s, "GET", "/api/v1/auth/me", memberToken, nil)
	if status != 401 {
		t.Fatalf("revoked session: %d", status)
	}
	if _, err := s.DB.Exec(t.Context(), "UPDATE sessions SET expires_at=now()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	status, _ = request(t, s, "GET", "/api/v1/auth/me", token, nil)
	if status != 401 {
		t.Fatalf("expired session: %d", status)
	}
}

func TestMessageIdempotencyAndPersistence(t *testing.T) {
	s := testServer(t)
	token := adminSession(t, s)
	code, channels := request(t, s, "GET", "/api/v1/channels", token, nil)
	if code != 200 {
		t.Fatal(code)
	}
	id := channels["channels"].([]any)[0].(map[string]any)["id"].(string)
	path := "/api/v1/channels/" + id + "/messages"
	body := map[string]string{"content": "hello", "client_id": "test-1"}
	code, first := request(t, s, "POST", path, token, body)
	if code != 201 {
		t.Fatal(code, first)
	}
	code, second := request(t, s, "POST", path, token, body)
	if code != 201 || first["id"] != second["id"] {
		t.Fatal("retry duplicated message")
	}
	body["content"] = "different"
	code, _ = request(t, s, "POST", path, token, body)
	if code != 409 {
		t.Fatal("accepted conflicting retry", code)
	}
	restarted := NewServer()
	restarted.DB = s.DB
	code, result := request(t, restarted, "GET", path, token, nil)
	if code != 200 || len(result["messages"].([]any)) != 1 {
		t.Fatal("history not durable", code, result)
	}
	code, _ = request(t, s, "GET", path+"?before=invalid", token, nil)
	if code != 400 {
		t.Fatal("invalid cursor", code)
	}
}

func TestRealtimePermissionAndDelivery(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	_, inv := request(t, s, "POST", "/api/v1/auth/invites", admin, nil)
	_, member := request(t, s, "POST", "/api/v1/auth/register", "", map[string]string{"username": "reader", "password": "test-password-strong", "invite": inv["invite"].(string)})
	token := member["token"].(string)
	userID := member["user"].(map[string]any)["id"].(string)
	status, channel := request(t, s, "POST", "/api/v1/channels", admin, map[string]any{"name": "private", "private": true})
	if status != 201 {
		t.Fatal(status, channel)
	}
	id := channel["id"].(string)
	path := "/api/v1/channels/" + id
	status, _ = request(t, s, "GET", path+"/messages", token, nil)
	if status != 403 {
		t.Fatal("private HTTP access", status)
	}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	connect := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/v1/events", nil)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(map[string]string{"token": token, "channel_id": id})
		if err = conn.Write(ctx, websocket.MessageText, data); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	denied := connect()
	_, _, err := denied.Read(ctx)
	denied.CloseNow()
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatal("private WS access", err)
	}
	status, _ = request(t, s, "PUT", path+"/members/"+userID, admin, nil)
	if status != 204 {
		t.Fatal(status)
	}
	conn := connect()
	defer conn.CloseNow()
	_, data, err := conn.Read(ctx)
	if err != nil || !bytes.Contains(data, []byte(`"sync"`)) {
		t.Fatal("no initial sync", err, string(data))
	}
	status, _ = request(t, s, "POST", path+"/messages", admin, map[string]string{"content": "visible", "client_id": "ws-1"})
	if status != 201 {
		t.Fatal(status)
	}
	_, data, err = conn.Read(ctx)
	if err != nil || !bytes.Contains(data, []byte(`"message.created"`)) {
		t.Fatal("no event", err, string(data))
	}
	status, _ = request(t, s, "DELETE", path+"/members/"+userID, admin, nil)
	if status != 204 {
		t.Fatal(status)
	}
	if _, _, err = conn.Read(ctx); err == nil {
		t.Fatal("revoked subscription survived")
	}
	status, _ = request(t, s, "GET", path+"/messages", token, nil)
	if status != 403 {
		t.Fatal("revoked HTTP access", status)
	}
}

func TestReconnectRecoversMissedMessage(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	_, inv := request(t, s, "POST", "/api/v1/auth/invites", admin, nil)
	_, member := request(t, s, "POST", "/api/v1/auth/register", "", map[string]string{"username": "reconnect", "password": "test-password-strong", "invite": inv["invite"].(string)})
	token := member["token"].(string)
	_, channels := request(t, s, "GET", "/api/v1/channels", token, nil)
	id := channels["channels"].([]any)[0].(map[string]any)["id"].(string)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	connect := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/v1/events", nil)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(map[string]string{"token": token, "channel_id": id})
		if err = conn.Write(ctx, websocket.MessageText, data); err != nil {
			t.Fatal(err)
		}
		if _, _, err = conn.Read(ctx); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	conn := connect()
	conn.CloseNow()
	code, _ := request(t, s, "POST", "/api/v1/channels/"+id+"/messages", admin, map[string]string{"content": "sent while offline", "client_id": "offline-1"})
	if code != 201 {
		t.Fatal(code)
	}
	again := connect()
	defer again.CloseNow()
	code, result := request(t, s, "GET", "/api/v1/channels/"+id+"/messages", token, nil)
	if code != 200 || len(result["messages"].([]any)) != 1 {
		t.Fatal("missed message not recovered", code, result)
	}
}
