package app

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (s *Server) search(w http.ResponseWriter, r *http.Request, u User) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 200 {
		fail(w, 400, "query_invalid", "Search requires 2–200 characters.")
		return
	}
	before := int64(9223372036854775807)
	if raw := r.URL.Query().Get("before"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 1 {
			fail(w, 400, "cursor_invalid", "Invalid cursor.")
			return
		}
		before = value
	}
	rows, err := s.DB.Query(r.Context(), `SELECT m.id::text,m.channel_id,m.user_id,u.username,m.content,m.client_id,m.created_at,COALESCE(m.file_id,''),m.edited_at FROM messages m JOIN users u ON u.id=m.user_id JOIN channels c ON c.id=m.channel_id WHERE `+accessible+` AND to_tsvector('simple',m.content) @@ websearch_to_tsquery('simple',$3) AND m.id<$4 ORDER BY m.id DESC LIMIT 50`, u.Role, u.ID, query, before)
	if err != nil {
		fail(w, 503, "database_unavailable", "Search is unavailable.")
		return
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Username, &m.Content, &m.ClientID, &m.CreatedAt, &m.FileID, &m.EditedAt); err != nil {
			fail(w, 503, "read_failed", "Search is unavailable.")
			return
		}
		result = append(result, m)
	}
	if rows.Err() != nil {
		fail(w, 503, "read_failed", "Search is unavailable.")
		return
	}
	next := ""
	if len(result) == 50 {
		next = result[len(result)-1].ID
	}
	JSON(w, 200, map[string]any{"messages": result, "next_cursor": next})
}
