package app

import "testing"

func memberSession(t *testing.T, s *Server, admin string) string {
	t.Helper()
	_, invite := request(t, s, "POST", "/api/v1/auth/invites", admin, nil)
	status, user := request(t, s, "POST", "/api/v1/auth/register", "", map[string]string{"username": "member", "password": "test-password-strong", "invite": invite["invite"].(string)})
	if status != 200 {
		t.Fatal(status, user)
	}
	return user["token"].(string)
}
func TestSearchRespectsChannelAccess(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	member := memberSession(t, s, admin)
	_, public := request(t, s, "POST", "/api/v1/channels", admin, map[string]string{"name": "public"})
	_, private := request(t, s, "POST", "/api/v1/channels", admin, map[string]any{"name": "private", "private": true})
	for _, channel := range []map[string]any{public, private} {
		status, result := request(t, s, "POST", "/api/v1/channels/"+channel["id"].(string)+"/messages", admin, map[string]string{"content": "searchable keyword", "client_id": "search-fixture"})
		if status != 201 {
			t.Fatal(status, result)
		}
	}
	status, result := request(t, s, "GET", "/api/v1/search?q=keyword", member, nil)
	if status != 200 || len(result["messages"].([]any)) != 1 {
		t.Fatal(status, result)
	}
	status, result = request(t, s, "GET", "/api/v1/search?q=keyword", admin, nil)
	if status != 200 || len(result["messages"].([]any)) != 2 {
		t.Fatal(status, result)
	}
}
