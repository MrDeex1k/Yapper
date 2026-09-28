package app

import (
	"net/http"
	"strconv"
)

func (s *Server) readState(w http.ResponseWriter, r *http.Request, u User) {
	channel := r.PathValue("channel")
	if !s.canAccess(r, u, channel) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	var body struct {
		Last string `json:"last_message_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	id, err := strconv.ParseInt(body.Last, 10, 64)
	if err != nil || id < 1 {
		fail(w, 400, "invalid_cursor", "Invalid read cursor.")
		return
	}
	var exists bool
	if err = s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)", id, channel).Scan(&exists); err != nil || !exists {
		fail(w, 400, "invalid_cursor", "Read cursor must refer to a message in this channel.")
		return
	}
	tag, err := s.DB.Exec(r.Context(), `INSERT INTO read_states(user_id,channel_id,last_message_id) VALUES($1,$2,$3) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_message_id=EXCLUDED.last_message_id WHERE read_states.last_message_id<EXCLUDED.last_message_id`, u.ID, channel, id)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not save read state.")
		return
	}
	if tag.RowsAffected() > 0 {
		s.eventsHub.publish(channel, "read.updated")
	}
	w.WriteHeader(204)
}
