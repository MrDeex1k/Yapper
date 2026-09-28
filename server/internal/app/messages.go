package app

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Message struct {
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
	rows, err := s.DB.Query(r.Context(), `SELECT m.id::text,m.channel_id,m.user_id,u.username,m.content,m.client_id,m.created_at FROM messages m JOIN users u ON u.id=m.user_id WHERE m.channel_id=$1 AND m.id<$2 ORDER BY m.id DESC LIMIT 50`, id, cursor)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not load history.")
		return
	}
	defer rows.Close()
	messages := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Username, &m.Content, &m.ClientID, &m.CreatedAt); err != nil {
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
	var m Message
	err := s.DB.QueryRow(r.Context(), `INSERT INTO messages(channel_id,user_id,content,client_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,channel_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id::text,channel_id,user_id,content,client_id,created_at`, id, u.ID, body.Content, body.ClientID).Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Content, &m.ClientID, &m.CreatedAt)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not save message. Retry with the same client ID.")
		return
	}
	if m.Content != body.Content {
		fail(w, 409, "idempotency_conflict", "This client ID was already used for another message.")
		return
	}
	m.Username = u.Username
	JSON(w, 201, m)
}
