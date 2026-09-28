package app

import (
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *Server) editMessage(w http.ResponseWriter, r *http.Request, u User) {
	channel := r.PathValue("channel")
	if !s.canAccess(r, u, channel) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("message"), 10, 64)
	if err != nil || id < 1 {
		fail(w, 400, "invalid_id", "Invalid message ID.")
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Content = strings.TrimSpace(body.Content)
	if body.Content == "" || !utf8.ValidString(body.Content) || utf8.RuneCountInString(body.Content) > 4000 {
		fail(w, 400, "message_invalid", "Use 1–4000 characters.")
		return
	}
	var edited time.Time
	err = s.DB.QueryRow(r.Context(), `UPDATE messages SET content=$1,edited_at=now() WHERE id=$2 AND channel_id=$3 AND (user_id=$4 OR $5 IN ('admin','moderator')) RETURNING edited_at`, body.Content, id, channel, u.ID, u.Role).Scan(&edited)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found", "Message not found or not editable.")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not edit message.")
		return
	}
	s.eventsHub.publish(channel, "message.updated")
	JSON(w, 200, map[string]any{"content": body.Content, "edited_at": edited})
}
