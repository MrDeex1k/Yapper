package app

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type RoomService interface {
	ListParticipants(context.Context, *livekit.ListParticipantsRequest) (*livekit.ListParticipantsResponse, error)
	RemoveParticipant(context.Context, *livekit.RoomParticipantIdentity) (*livekit.RemoveParticipantResponse, error)
}
type Media struct {
	Key, Secret, PublicURL string
	Rooms                  RoomService
}

func NewMedia(key, secret, internal, public string) (*Media, error) {
	if len(secret) < 32 || key == "" {
		return nil, fmt.Errorf("LiveKit key and at least 32-byte secret required")
	}
	for _, raw := range []string{internal, public} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || !strings.Contains("|http|https|ws|wss|", "|"+u.Scheme+"|") {
			return nil, fmt.Errorf("invalid LiveKit URL")
		}
	}
	return &Media{key, secret, public, lksdk.NewRoomServiceClient(internal, key, secret)}, nil
}
func (s *Server) voiceJoin(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("channel")
	if !s.canAccess(r, u, id) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	var kind string
	if err := s.DB.QueryRow(r.Context(), "SELECT kind FROM channels WHERE id=$1", id).Scan(&kind); err != nil || kind != "voice" {
		fail(w, 400, "not_voice", "Choose a voice channel.")
		return
	}
	if s.Media == nil {
		fail(w, 503, "media_unavailable", "Voice is not configured on this server.")
		return
	}
	session := tokenHash(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if _, err := s.DB.Exec(r.Context(), `INSERT INTO media_grants(user_id,channel_id,session_hash) VALUES($1,$2,$3) ON CONFLICT(user_id,channel_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,issued_at=now()`, u.ID, id, session); err != nil {
		fail(w, 503, "database_unavailable", "Could not authorize voice.")
		return
	}
	token, err := auth.NewAccessToken(s.Media.Key, s.Media.Secret).SetIdentity(u.ID).SetName(u.Username).SetValidFor(time.Minute).SetVideoGrant(&auth.VideoGrant{RoomJoin: true, Room: id, CanPublish: new(true), CanSubscribe: new(true), CanPublishData: new(false), CanUpdateOwnMetadata: new(false), CanPublishSources: []string{"microphone"}}).ToJWT()
	if err != nil {
		fail(w, 500, "media_token_failed", "Could not authorize voice.")
		return
	}
	JSON(w, 200, map[string]any{"token": token, "url": s.Media.PublicURL, "room": id, "expires_in": 60})
}
func (s *Server) voiceParticipants(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("channel")
	if !s.canAccess(r, u, id) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	if s.Media == nil {
		fail(w, 503, "media_unavailable", "Voice is not configured.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	result, err := s.Media.Rooms.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: id})
	if err != nil {
		fail(w, 503, "media_unavailable", "Could not query voice participants.")
		return
	}
	participants := []map[string]string{}
	for _, p := range result.Participants {
		participants = append(participants, map[string]string{"id": p.Identity, "name": p.Name})
	}
	JSON(w, 200, map[string]any{"participants": participants})
}
