package app

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

type ManagedUser struct {
	User
	Banned bool `json:"banned"`
}

func (s *Server) users(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role == "member" {
		fail(w, 403, "forbidden", "Moderator access required.")
		return
	}
	rows, err := s.DB.Query(r.Context(), "SELECT id,username,role,banned FROM users ORDER BY username LIMIT 500")
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not load users.")
		return
	}
	defer rows.Close()
	users := []ManagedUser{}
	for rows.Next() {
		var v ManagedUser
		if rows.Scan(&v.ID, &v.Username, &v.Role, &v.Banned) != nil {
			fail(w, 503, "read_failed", "Could not load users.")
			return
		}
		users = append(users, v)
	}
	if rows.Err() != nil {
		fail(w, 503, "read_failed", "Could not load users.")
		return
	}
	JSON(w, 200, map[string]any{"users": users, "limit": 500})
}
func (s *Server) updateUser(w http.ResponseWriter, r *http.Request, u User) {
	var body struct {
		Role   *string `json:"role"`
		Banned *bool   `json:"banned"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Role == nil && body.Banned == nil {
		fail(w, 400, "invalid_change", "Choose a role or ban state.")
		return
	}
	if body.Role != nil && *body.Role != "admin" && *body.Role != "moderator" && *body.Role != "member" {
		fail(w, 400, "invalid_role", "Invalid role.")
		return
	}
	target := r.PathValue("user")
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(704221)"); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	var role string
	var banned bool
	if err = tx.QueryRow(r.Context(), "SELECT role,banned FROM users WHERE id=$1", u.ID).Scan(&role, &banned); err != nil || banned || role == "member" {
		fail(w, 403, "forbidden", "Moderator access required.")
		return
	}
	var current ManagedUser
	if err = tx.QueryRow(r.Context(), "SELECT id,username,role,banned FROM users WHERE id=$1 FOR UPDATE", target).Scan(&current.ID, &current.Username, &current.Role, &current.Banned); err != nil {
		fail(w, 404, "not_found", "User not found.")
		return
	}
	if role != "admin" && (body.Role != nil || current.Role != "member") {
		fail(w, 403, "forbidden", "Only administrators manage privileged accounts and roles.")
		return
	}
	if target == u.ID && body.Banned != nil && *body.Banned {
		fail(w, 409, "self_ban", "You cannot ban yourself.")
		return
	}
	next := current
	if body.Role != nil {
		next.Role = *body.Role
	}
	if body.Banned != nil {
		next.Banned = *body.Banned
	}
	if current.Role == "admin" && !current.Banned && (next.Role != "admin" || next.Banned) {
		var count int
		if err = tx.QueryRow(r.Context(), "SELECT count(*) FROM users WHERE role='admin' AND NOT banned").Scan(&count); err != nil {
			fail(w, 503, "database_unavailable", "Try again later.")
			return
		}
		if count < 2 {
			fail(w, 409, "last_admin", "Keep at least one active administrator.")
			return
		}
	}
	if _, err = tx.Exec(r.Context(), "UPDATE users SET role=$2,banned=$3 WHERE id=$1", target, next.Role, next.Banned); err != nil {
		fail(w, 503, "database_unavailable", "Could not update user.")
		return
	}
	if _, err = tx.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1", target); err != nil {
		fail(w, 503, "database_unavailable", "Could not revoke sessions.")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "Could not save user.")
		return
	}
	s.eventsHub.revoke(target, "")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if s.revokeMedia(ctx, target, "") != nil {
		fail(w, 503, "disconnect_pending", "User updated; SFU disconnect is pending reconciliation.")
		return
	}
	JSON(w, 200, next)
}
func (s *Server) deleteMessage(w http.ResponseWriter, r *http.Request, u User) {
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
	tag, err := s.DB.Exec(r.Context(), "DELETE FROM messages WHERE id=$1 AND channel_id=$2 AND (user_id=$3 OR $4 IN ('admin','moderator'))", id, channel, u.ID, u.Role)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not delete message.")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "not_found", "Message not found or not editable.")
		return
	}
	s.eventsHub.publish(channel, "message.deleted")
	w.WriteHeader(204)
}
