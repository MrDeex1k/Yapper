package httpapi

import (
	"net/http"

	"github.com/MrDeex1k/Yapper/server/internal/community"
)

func (a *CommunityAPI) requireOwner(w http.ResponseWriter, r *http.Request) (principal, bool) {
	p, ok := a.require(w, r)
	if !ok {
		return p, false
	}
	if p.participant.Role != "owner" {
		fail(w, 403, "access_denied")
		return p, false
	}
	return p, true
}

func (a *CommunityAPI) setAdmission(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireOwner(w, r)
	if !ok {
		return
	}
	var body struct {
		Open *bool `json:"openAdmission"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Open == nil {
		fail(w, 400, "invalid_request")
		return
	}
	if err := a.store.SetOpenAdmission(r.Context(), p.participant.ID, *body.Open); err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"openAdmission": *body.Open})
}

func (a *CommunityAPI) invitations(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireOwner(w, r)
	if !ok {
		return
	}
	invitations, err := a.store.Invitations(r.Context(), p.participant.ID)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string][]community.Invitation{"invitations": invitations})
}

func (a *CommunityAPI) invite(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireOwner(w, r)
	if !ok {
		return
	}
	body := struct {
		ExpiresInHours *int32 `json:"expiresInHours"`
		MaxUses        *int32 `json:"maxUses"`
	}{new(int32(24)), new(int32(1))}
	if r.ContentLength != 0 && !decode(w, r, &body) {
		return
	}
	// Bound finite expirations to a date that Go can encode as RFC 3339.
	if body.ExpiresInHours == nil || *body.ExpiresInHours < 0 || *body.ExpiresInHours > 876000 ||
		body.MaxUses == nil || *body.MaxUses < 0 {
		fail(w, 400, "invalid_request")
		return
	}
	invitation, err := a.store.CreateInvitation(r.Context(), p.participant.ID, community.InvitationOptions{
		ExpiresInHours: *body.ExpiresInHours, MaxUses: *body.MaxUses,
	})
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 201, invitation)
}

func (a *CommunityAPI) revokeInvitation(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireOwner(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		fail(w, 400, "invalid_request")
		return
	}
	if err := a.store.RevokeInvitation(r.Context(), p.participant.ID, id); err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"revoked": true})
}
