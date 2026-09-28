package app

import "testing"

func TestModerationRevokesSessionAndProtectsLastAdmin(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	_, me := request(t, s, "GET", "/api/v1/auth/me", admin, nil)
	status, _ := request(t, s, "PATCH", "/api/v1/admin/users/"+me["id"].(string), admin, map[string]string{"role": "member"})
	if status != 409 {
		t.Fatalf("last admin demotion: %d", status)
	}
	_, invite := request(t, s, "POST", "/api/v1/auth/invites", admin, nil)
	status, member := request(t, s, "POST", "/api/v1/auth/register", "", map[string]string{"username": "member", "password": "strong-test-password", "invite": invite["invite"].(string)})
	if status != 200 {
		t.Fatal(status, member)
	}
	token := member["token"].(string)
	_, user := request(t, s, "GET", "/api/v1/auth/me", token, nil)
	status, _ = request(t, s, "PATCH", "/api/v1/admin/users/"+me["id"].(string), token, map[string]bool{"banned": true})
	if status != 403 {
		t.Fatalf("member moderation: %d", status)
	}
	status, _ = request(t, s, "PATCH", "/api/v1/admin/users/"+user["id"].(string), admin, map[string]bool{"banned": true})
	if status != 200 {
		t.Fatalf("ban: %d", status)
	}
	status, _ = request(t, s, "GET", "/api/v1/auth/me", token, nil)
	if status != 401 {
		t.Fatalf("banned session: %d", status)
	}
}
