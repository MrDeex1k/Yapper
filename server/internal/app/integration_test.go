package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testServer(t *testing.T) *Server {
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
	if err = Migrate(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(t.Context(), pool); err != nil {
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
