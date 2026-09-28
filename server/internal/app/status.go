package app

import (
	"context"
	"errors"
	"github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
	"net/http"
	"time"
)

func (s *Server) status(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role != "admin" {
		fail(w, 403, "forbidden", "Administrator access required.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var bytes, users, channels, messages int64
	if err := s.DB.QueryRow(ctx, `SELECT pg_database_size(current_database()),(SELECT count(*) FROM users),(SELECT count(*) FROM channels),(SELECT count(*) FROM messages)`).Scan(&bytes, &users, &channels, &messages); err != nil {
		fail(w, 503, "database_unavailable", "Could not inspect storage.")
		return
	}
	media := "disabled"
	if s.Media != nil {
		media = "available"
		_, err := s.Media.Rooms.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: "__yapper_health_probe__"})
		if err != nil {
			e, ok := errors.AsType[twirp.Error](err)
			if !ok || e.Code() != twirp.NotFound {
				media = "unavailable"
			}
		}
	}
	JSON(w, 200, map[string]any{"version": Version, "ready": s.ready.Load(), "database": "available", "database_bytes": bytes, "users": users, "channels": channels, "messages": messages, "media": media})
}
