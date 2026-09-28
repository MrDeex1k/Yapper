package app

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func uploadFile(t *testing.T, s *Server, token, channel, content string) (int, map[string]any) {
	t.Helper()
	var data bytes.Buffer
	m := multipart.NewWriter(&data)
	part, err := m.CreateFormFile("file", "note.html")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte(content))
	m.Close()
	r := httptest.NewRequest("POST", "/api/v1/channels/"+channel+"/files", &data)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	result := map[string]any{}
	if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(w.Body.String())
	}
	return w.Code, result
}
func TestFilesEnforceAccessQuotaAndAttachmentBinding(t *testing.T) {
	s := testServer(t)
	store, err := NewFileStore(t.TempDir(), 16, 20)
	if err != nil {
		t.Fatal(err)
	}
	s.Files = store
	t.Cleanup(func() { store.Root.Close() })
	admin := adminSession(t, s)
	_, channel := request(t, s, "POST", "/api/v1/channels", admin, map[string]any{"name": "private", "private": true})
	id := channel["id"].(string)
	_, inv := request(t, s, "POST", "/api/v1/auth/invites", admin, nil)
	_, member := request(t, s, "POST", "/api/v1/auth/register", "", map[string]string{"username": "member", "password": "test-password-long", "invite": inv["invite"].(string)})
	token := member["token"].(string)
	_, me := request(t, s, "GET", "/api/v1/auth/me", token, nil)
	userID := me["id"].(string)
	status, _ := uploadFile(t, s, token, id, "private")
	if status != 403 {
		t.Fatal("unauthorized upload", status)
	}
	request(t, s, "PUT", "/api/v1/channels/"+id+"/members/"+userID, admin, nil)
	status, file := uploadFile(t, s, token, id, "<b>safe</b>")
	if status != 201 {
		t.Fatal(status, file)
	}
	fileID := file["id"].(string)
	status, _ = uploadFile(t, s, token, id, strings.Repeat("x", 16))
	if status != 413 {
		t.Fatal("quota", status)
	}
	status, result := request(t, s, "POST", "/api/v1/channels/"+id+"/messages", token, map[string]string{"content": "file", "client_id": "file-message", "file_id": fileID})
	if status != 201 || result["file_id"] != fileID {
		t.Fatal(status, result)
	}
	status, _ = request(t, s, "POST", "/api/v1/channels/"+id+"/messages", admin, map[string]string{"content": "stolen", "client_id": "other", "file_id": fileID})
	if status != 400 {
		t.Fatal("foreign file attachment", status)
	}
	get := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/files/"+fileID, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	w := get(token)
	if w.Code != 200 || w.Body.String() != "<b>safe</b>" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal(w.Code, w.Header(), w.Body.String())
	}
	request(t, s, "DELETE", "/api/v1/channels/"+id+"/members/"+userID, admin, nil)
	if w = get(token); w.Code != 404 {
		t.Fatal("revoked download", w.Code)
	}
	if w = get(""); w.Code != 401 {
		t.Fatal("anonymous download", w.Code)
	}
}

func TestFileGCRequiresApplyAndPreservesFreshObjects(t *testing.T) {
	s := testServer(t)
	store, err := NewFileStore(t.TempDir(), 16, 32)
	if err != nil {
		t.Fatal(err)
	}
	s.Files = store
	t.Cleanup(func() { store.Root.Close() })
	old, _, err := store.Write(strings.NewReader("orphan"), 16)
	if err != nil {
		t.Fatal(err)
	}
	fresh, _, err := store.Write(strings.NewReader("fresh"), 16)
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-48 * time.Hour)
	if err = store.Root.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}
	if err = s.CleanupFiles(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Root.Stat(old); err != nil {
		t.Fatal("dry run removed object", err)
	}
	if err = s.CleanupFiles(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Root.Stat(old); err == nil {
		t.Fatal("orphan retained")
	}
	if _, err = store.Root.Stat(fresh); err != nil {
		t.Fatal("fresh upload removed", err)
	}
}
