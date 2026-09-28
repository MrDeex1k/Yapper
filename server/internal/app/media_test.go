package app

import (
	"context"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"net/http"
	"testing"
)

type fakeRooms struct {
	participants []*livekit.ParticipantInfo
	removed      []string
}

func (f *fakeRooms) ListParticipants(context.Context, *livekit.ListParticipantsRequest) (*livekit.ListParticipantsResponse, error) {
	return &livekit.ListParticipantsResponse{Participants: f.participants}, nil
}
func (f *fakeRooms) RemoveParticipant(_ context.Context, p *livekit.RoomParticipantIdentity) (*livekit.RemoveParticipantResponse, error) {
	f.removed = append(f.removed, p.Identity)
	return &livekit.RemoveParticipantResponse{}, nil
}
func TestMediaGrantScopeAndRevocation(t *testing.T) {
	s := testServer(t)
	token := adminSession(t, s)
	rooms := &fakeRooms{}
	s.Media = &Media{Key: "testkey", Secret: "01234567890123456789012345678901", PublicURL: "ws://localhost:17880", Rooms: rooms}
	code, channel := request(t, s, http.MethodPost, "/api/v1/channels", token, map[string]any{"name": "voice", "kind": "voice"})
	if code != 201 {
		t.Fatal(code)
	}
	id := channel["id"].(string)
	code, grant := request(t, s, "POST", "/api/v1/channels/"+id+"/voice", token, nil)
	if code != 200 {
		t.Fatal(code, grant)
	}
	parsed, err := auth.ParseAPIToken(grant["token"].(string))
	if err != nil {
		t.Fatal(err)
	}
	_, claims, err := parsed.Verify(s.Media.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Video.Room != id || !claims.Video.RoomJoin || claims.Video.GetCanPublishData() || len(claims.Video.CanPublishSources) != 1 || claims.Video.CanPublishSources[0] != "microphone" {
		t.Fatal("overbroad media grant")
	}
	rooms.participants = []*livekit.ParticipantInfo{{Identity: claims.Identity}}
	if err = s.reconcileMediaOnce(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(rooms.removed) != 0 {
		t.Fatal("removed allowed participant")
	}
	if _, err = s.DB.Exec(t.Context(), "DELETE FROM sessions"); err != nil {
		t.Fatal(err)
	}
	if err = s.reconcileMediaOnce(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(rooms.removed) != 1 {
		t.Fatal("revoked session left in SFU")
	}
}

func TestScreenGrantRespectsHostSetting(t *testing.T) {
	s := testServer(t)
	token := adminSession(t, s)
	s.Media = &Media{Key: "testkey", Secret: "01234567890123456789012345678901", PublicURL: "ws://localhost:17880", Rooms: &fakeRooms{}}
	_, channel := request(t, s, "POST", "/api/v1/channels", token, map[string]string{"name": "screens", "kind": "voice"})
	for _, allow := range []bool{false, true} {
		s.AllowScreen = allow
		status, grant := request(t, s, "POST", "/api/v1/channels/"+channel["id"].(string)+"/voice", token, nil)
		if status != 200 {
			t.Fatal(status, grant)
		}
		parsed, err := auth.ParseAPIToken(grant["token"].(string))
		if err != nil {
			t.Fatal(err)
		}
		_, claims, err := parsed.Verify(s.Media.Secret)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, source := range claims.Video.CanPublishSources {
			if source == "screen_share" {
				found = true
			}
			if source == "camera" || source == "screen_share_audio" {
				t.Fatal("unexpected source", source)
			}
		}
		if found != allow {
			t.Fatal("screen policy not applied")
		}
	}
}

func TestReconciliationLimitsSimultaneousScreens(t *testing.T) {
	s := testServer(t)
	admin := adminSession(t, s)
	member := memberSession(t, s, admin)
	s.AllowScreen = true
	s.MaxScreens = 1
	rooms := &fakeRooms{}
	s.Media = &Media{Key: "testkey", Secret: "01234567890123456789012345678901", PublicURL: "ws://localhost:17880", Rooms: rooms}
	_, channel := request(t, s, "POST", "/api/v1/channels", admin, map[string]string{"name": "screens", "kind": "voice"})
	for i, token := range []string{admin, member} {
		status, grant := request(t, s, "POST", "/api/v1/channels/"+channel["id"].(string)+"/voice", token, nil)
		if status != 200 {
			t.Fatal(status, grant)
		}
		_, user := request(t, s, "GET", "/api/v1/auth/me", token, nil)
		rooms.participants = append(rooms.participants, &livekit.ParticipantInfo{Identity: user["id"].(string), JoinedAt: int64(i + 1), Tracks: []*livekit.TrackInfo{{Source: livekit.TrackSource_SCREEN_SHARE}}})
	}
	if err := s.reconcileMediaOnce(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(rooms.removed) != 1 || rooms.removed[0] != rooms.participants[1].Identity {
		t.Fatal("screen limit not enforced", rooms.removed)
	}
}
