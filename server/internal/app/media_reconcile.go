package app

import (
	"cmp"
	"context"
	"errors"
	"github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
	"log/slog"
	"net/http"
	"slices"
	"time"
)

func (s *Server) removeMediaParticipant(ctx context.Context, room, user string) error {
	_, err := s.Media.Rooms.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{Room: room, Identity: user})
	if te, ok := errors.AsType[twirp.Error](err); ok && te.Code() == twirp.NotFound {
		return nil
	}
	return err
}
func (s *Server) revokeMedia(ctx context.Context, user, channel string) error {
	if s.Media == nil {
		return nil
	}
	if _, err := s.DB.Exec(ctx, "DELETE FROM media_grants WHERE user_id=$1 AND ($2='' OR channel_id=$2)", user, channel); err != nil {
		return err
	}
	rows, err := s.DB.Query(ctx, "SELECT id FROM channels WHERE kind='voice' AND ($1='' OR id=$1)", channel)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	var result error
	for _, id := range ids {
		result = errors.Join(result, s.removeMediaParticipant(ctx, id, user))
	}
	return result
}
func (s *Server) voiceLeave(w http.ResponseWriter, r *http.Request, u User) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.revokeMedia(ctx, u.ID, r.PathValue("channel")); err != nil {
		fail(w, 503, "disconnect_pending", "Voice authorization revoked; SFU disconnect will be retried.")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) ReconcileMedia(ctx context.Context) {
	if s.DB == nil {
		return
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cycle, cancel := context.WithTimeout(ctx, 10*time.Second)
			_, cleanupErr := s.DB.Exec(cycle, "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<now() LIMIT 1000)")
			if cleanupErr != nil && ctx.Err() == nil {
				slog.Warn("session_cleanup_failed")
			}
			if s.Media == nil {
				cancel()
				continue
			}
			if err := s.reconcileMediaOnce(cycle); err != nil && ctx.Err() == nil {
				slog.Warn("media_reconcile_failed")
			}
			cancel()
		}
	}
}
func (s *Server) reconcileMediaOnce(ctx context.Context) error {
	rows, err := s.DB.Query(ctx, "SELECT id FROM channels WHERE kind='voice'")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		participants, err := s.Media.Rooms.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: id})
		if err != nil {
			return err
		}
		slices.SortFunc(participants.Participants, func(a, b *livekit.ParticipantInfo) int {
			if order := cmp.Compare(a.JoinedAt, b.JoinedAt); order != 0 {
				return order
			}
			return cmp.Compare(a.Identity, b.Identity)
		})
		screens := 0
		for _, p := range participants.Participants {
			var allowed bool
			err = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM media_grants g JOIN users u ON u.id=g.user_id JOIN sessions s ON s.token_hash=g.session_hash AND s.user_id=u.id JOIN channels c ON c.id=g.channel_id WHERE g.user_id=$1 AND g.channel_id=$2 AND NOT u.banned AND s.expires_at>now() AND (NOT c.private OR u.role='admin' OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.user_id=u.id AND cm.channel_id=c.id)))`, p.Identity, id).Scan(&allowed)
			if err != nil {
				return err
			}
			allowed = allowed && s.validMediaSources(p)
			if allowed && hasScreen(p) {
				screens++
				if screens > s.MaxScreens {
					allowed = false
				}
			}
			if !allowed {
				if err = s.removeMediaParticipant(ctx, id, p.Identity); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
