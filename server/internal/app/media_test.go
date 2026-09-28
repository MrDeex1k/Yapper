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
