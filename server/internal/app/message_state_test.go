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

func TestEditingPreservesSendIdempotency(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	member := memberSession(t, s, admin)
	_, channels := request(t, s, "GET", "/api/v1/channels", admin, nil)
	channel := channels["channels"].([]any)[0].(map[string]any)["id"].(string)
	body := map[string]string{"content": "original", "client_id": "stable-key"}
	status, message := request(t, s, "POST", "/api/v1/channels/"+channel+"/messages", admin, body)
	if status != 201 {
		t.Fatal(status, message)
	}
	route := "/api/v1/channels/" + channel + "/messages/" + message["id"].(string)
	status, _ = request(t, s, "PATCH", route, member, map[string]string{"content": "unauthorized"})
	if status != 404 {
		t.Fatal("foreign edit", status)
	}
	status, _ = request(t, s, "PATCH", route, admin, map[string]string{"content": "edited"})
	if status != 200 {
		t.Fatal("edit", status)
	}
	status, retry := request(t, s, "POST", "/api/v1/channels/"+channel+"/messages", admin, body)
	if status != 201 || retry["id"] != message["id"] || retry["content"] != "edited" {
		t.Fatal("retry reverted edit", status, retry)
	}
}

func TestReadCursorOnlyAdvancesAcrossSessions(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	member := memberSession(t, s, admin)
	_, channels := request(t, s, "GET", "/api/v1/channels", admin, nil)
	channel := channels["channels"].([]any)[0].(map[string]any)["id"].(string)
	ids := []string{}
	for _, key := range []string{"one", "two"} {
		_, message := request(t, s, "POST", "/api/v1/channels/"+channel+"/messages", admin, map[string]string{"content": key, "client_id": key})
		ids = append(ids, message["id"].(string))
	}
	for _, id := range []string{ids[1], ids[0]} {
		status, result := request(t, s, "PUT", "/api/v1/channels/"+channel+"/read-state", member, map[string]string{"last_message_id": id})
		if status != 204 {
			t.Fatal(status, result)
		}
	}
	status, login := request(t, s, "POST", "/api/v1/auth/login", "", map[string]string{"username": "member", "password": "test-password-strong"})
	if status != 200 {
		t.Fatal(status, login)
	}
	_, channels = request(t, s, "GET", "/api/v1/channels", login["token"].(string), nil)
	if channels["channels"].([]any)[0].(map[string]any)["unread"] != float64(0) {
		t.Fatal("cursor regressed", channels)
	}
}
