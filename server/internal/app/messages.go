package app

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Message struct {
	FileID    string    `json:"file_id"`
	ID        string    `json:"id"`
	ChannelID string    `json:"channel_id"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	ClientID  string    `json:"client_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("channel")
	if !s.canAccess(r, u, id) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	cursor := int64(9223372036854775807)
	if raw := r.URL.Query().Get("before"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			fail(w, 400, "cursor_invalid", "Invalid history cursor.")
			return
		}
		cursor = n
	}
	rows, err := s.DB.Query(r.Context(), `SELECT m.id::text,m.channel_id,m.user_id,u.username,m.content,m.client_id,m.created_at,COALESCE(m.file_id,'') FROM messages m JOIN users u ON u.id=m.user_id WHERE m.channel_id=$1 AND m.id<$2 ORDER BY m.id DESC LIMIT 50`, id, cursor)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not load history.")
		return
	}
	defer rows.Close()
	messages := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Username, &m.Content, &m.ClientID, &m.CreatedAt, &m.FileID); err != nil {
			fail(w, 500, "read_failed", "Could not load history.")
			return
		}
		messages = append(messages, m)
	}
	if rows.Err() != nil {
		fail(w, 503, "database_unavailable", "Could not load history.")
		return
	}
	next := ""
	if len(messages) == 50 {
		next = messages[len(messages)-1].ID
	}
	JSON(w, 200, map[string]any{"messages": messages, "next_cursor": next})
}
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("channel")
	if !s.canAccess(r, u, id) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	var body struct {
		FileID   string `json:"file_id"`
		Content  string `json:"content"`
		ClientID string `json:"client_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Content = strings.TrimSpace(body.Content)
	if body.Content == "" || !utf8.ValidString(body.Content) || utf8.RuneCountInString(body.Content) > 4000 || len(body.ClientID) < 1 || len(body.ClientID) > 128 {
		fail(w, 400, "message_invalid", "Message must contain 1–4000 characters and a client ID.")
		return
	}
	if body.FileID != "" {
		var allowed bool
		err := s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM attachments WHERE id=$1 AND channel_id=$2 AND user_id=$3)", body.FileID, id, u.ID).Scan(&allowed)
		if err != nil || !allowed {
			fail(w, 400, "attachment_invalid", "Upload your own file to this channel first.")
			return
		}
	}
	var m Message
	err := s.DB.QueryRow(r.Context(), `INSERT INTO messages(channel_id,user_id,content,client_id,file_id) VALUES($1,$2,$3,$4,NULLIF($5,'')) ON CONFLICT(user_id,channel_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id::text,channel_id,user_id,content,client_id,created_at,COALESCE(file_id,'')`, id, u.ID, body.Content, body.ClientID, body.FileID).Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Content, &m.ClientID, &m.CreatedAt, &m.FileID)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not save message. Retry with the same client ID.")
		return
	}
	if m.Content != body.Content || m.FileID != body.FileID {
		fail(w, 409, "idempotency_conflict", "This client ID was already used for another message.")
		return
	}
	s.eventsHub.publish(id, "message.created")
	m.Username = u.Username
	JSON(w, 201, m)
}
