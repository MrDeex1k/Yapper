package app

import (
	"context"
	"crypto/rand"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type Channel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Private bool   `json:"private"`
}

const accessible = `(NOT c.private OR $1='admin' OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=$2))`

func (s *Server) canAccess(r *http.Request, user User, id string) bool {
	var ok bool
	err := s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM channels c WHERE c.id=$3 AND "+accessible+")", user.Role, user.ID, id).Scan(&ok)
	return err == nil && ok
}
func (s *Server) channels(w http.ResponseWriter, r *http.Request, user User) {
	rows, err := s.DB.Query(r.Context(), "SELECT c.id,c.name,c.kind,c.private FROM channels c WHERE "+accessible+" ORDER BY c.created_at,c.id", user.Role, user.ID)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not load channels.")
		return
	}
	defer rows.Close()
	channels := []Channel{}
	for rows.Next() {
		var c Channel
		if err = rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Private); err != nil {
			fail(w, 500, "read_failed", "Could not load channels.")
			return
		}
		channels = append(channels, c)
	}
	if rows.Err() != nil {
		fail(w, 503, "database_unavailable", "Could not load channels.")
		return
	}
	JSON(w, 200, map[string]any{"channels": channels})
}
func (s *Server) createChannel(w http.ResponseWriter, r *http.Request, user User) {
	if user.Role != "admin" {
		fail(w, 403, "forbidden", "Administrator access required.")
		return
	}
	var body struct {
		Name    string `json:"name"`
		Private bool   `json:"private"`
		Kind    string `json:"kind"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Kind == "" {
		body.Kind = "text"
	}
	if body.Name == "" || utf8.RuneCountInString(body.Name) > 64 || (body.Kind != "text" && body.Kind != "voice") {
		fail(w, 400, "channel_invalid", "Use a name of 1–64 characters and a text or voice channel.")
		return
	}
	c := Channel{rand.Text(), body.Name, body.Kind, body.Private}
	if _, err := s.DB.Exec(r.Context(), "INSERT INTO channels(id,name,kind,private) VALUES($1,$2,$3,$4)", c.ID, c.Name, c.Kind, c.Private); err != nil {
		fail(w, 503, "database_unavailable", "Could not create channel.")
		return
	}
	JSON(w, 201, c)
}

func (s *Server) membership(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role != "admin" {
		fail(w, 403, "forbidden", "Administrator access required.")
		return
	}
	channel, user := r.PathValue("channel"), r.PathValue("user")
	if !s.canAccess(r, u, channel) {
		fail(w, 404, "not_found", "Channel not found.")
		return
	}
	if r.Method == http.MethodDelete {
		if _, err := s.DB.Exec(r.Context(), "DELETE FROM channel_members WHERE channel_id=$1 AND user_id=$2", channel, user); err != nil {
			fail(w, 503, "database_unavailable", "Could not revoke access.")
			return
		}
		s.eventsHub.revoke(user, channel)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := s.revokeMedia(ctx, user, channel); err != nil {
			fail(w, 503, "disconnect_pending", "Access revoked; SFU disconnect will be retried.")
			return
		}
		w.WriteHeader(204)
		return
	}
	tag, err := s.DB.Exec(r.Context(), "INSERT INTO channel_members(channel_id,user_id) SELECT $1,id FROM users WHERE id=$2 AND NOT banned ON CONFLICT DO NOTHING", channel, user)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not add member.")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "member_conflict", "Member already exists or user is unavailable.")
		return
	}
	w.WriteHeader(204)
}
