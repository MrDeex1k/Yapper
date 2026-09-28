package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestUpgradeFromF04PreservesHistoryAndRetries(t *testing.T) {
	pool := testDatabase(t)
	if _, err := pool.Exec(t.Context(), "CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		t.Fatal(err)
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "001_") && !strings.HasPrefix(entry.Name(), "002_") {
			continue
		}
		data, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), string(data)); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if _, err = pool.Exec(t.Context(), "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", entry.Name(), hex.EncodeToString(sum[:])); err != nil {
			t.Fatal(err)
		}
	}
	s := NewServer()
	s.DB = pool
	s.BootstrapToken = "test-bootstrap-only"
	token := adminSession(t, s)
	var channel, user, id string
	if err = pool.QueryRow(t.Context(), "SELECT id FROM channels LIMIT 1").Scan(&channel); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), "SELECT id FROM users LIMIT 1").Scan(&user); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), "INSERT INTO messages(channel_id,user_id,content,client_id) VALUES($1,$2,'preserve during upgrade','old-client-id') RETURNING id::text", channel, user).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	status, history := request(t, s, "GET", "/api/v1/channels/"+channel+"/messages", token, nil)
	if status != 200 || len(history["messages"].([]any)) != 1 {
		t.Fatal(status, history)
	}
	status, retry := request(t, s, "POST", "/api/v1/channels/"+channel+"/messages", token, map[string]string{"content": "preserve during upgrade", "client_id": "old-client-id"})
	if status != 201 || retry["id"] != id {
		t.Fatal("upgrade broke retry", status, retry)
	}
}
