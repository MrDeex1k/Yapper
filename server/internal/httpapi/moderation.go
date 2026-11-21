package httpapi

import (
	"context"
	"net/http"
	"regexp"

	"github.com/MrDeex1k/Yapper/server/internal/community"
)

var accountName = regexp.MustCompile(`^[a-zA-Z0-9_]{3,32}$`)

func (a *CommunityAPI) moderationRoutes() {
	a.mux.HandleFunc("GET /api/v1/participants", a.members)
	a.mux.HandleFunc("GET /api/v1/moderation/audit", a.audit)
	a.mux.HandleFunc("POST /api/v1/moderators", a.provisionModerator)
	a.mux.HandleFunc("POST /api/v1/participants/{id}/ban", a.ban)
	a.mux.HandleFunc("POST /api/v1/participants/{id}/moderate", a.moderate)
}

func (a *CommunityAPI) members(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	after := r.URL.Query().Get("after")
	target := r.URL.Query().Get("target")
	if after != "" && !validID(after) || target != "" && !validID(target) || after != "" && target != "" {
		fail(w, 400, "invalid_request")
		return
	}
	page, err := a.store.Members(r.Context(), p.participant.ID, after, target)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, page)
}

func (a *CommunityAPI) audit(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	events, err := a.store.Audit(r.Context(), p.participant.ID)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Events []community.AuditEvent `json:"events"`
	}{events})
}

func (a *CommunityAPI) provisionModerator(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !accountName.MatchString(input.Username) || !validPassword(input.Password) {
		fail(w, 400, "invalid_request")
		return
	}
	err := a.store.ProvisionModerator(r.Context(), p.participant.ID, input.Username, func(ctx context.Context) (string, error) {
		return a.auth.ProvisionModerator(ctx, input.Username, input.Password)
	})
	if err != nil {
		resultError(w, err)
		return
	}
	a.broadcast("members.changed", struct{}{})
	writeJSON(w, 200, map[string]bool{"saved": true})
}

func (a *CommunityAPI) ban(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		fail(w, 400, "invalid_request")
		return
	}
	if a.applyModeration(w, r, p.participant.ID, id, community.Ban, false) {
		writeJSON(w, 200, map[string]bool{"banned": true})
	}
}

func (a *CommunityAPI) moderate(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var input struct {
		Action  community.ModerationAction `json:"action"`
		BlockIP bool                       `json:"blockIp"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !validID(id) || !input.Action.Valid() || input.BlockIP && input.Action != community.Ban {
		fail(w, 400, "invalid_request")
		return
	}
	if a.applyModeration(w, r, p.participant.ID, id, input.Action, input.BlockIP) {
		writeJSON(w, 200, map[string]bool{"saved": true})
	}
}

func (a *CommunityAPI) applyModeration(w http.ResponseWriter, r *http.Request, actor, target string, action community.ModerationAction, blockIP bool) bool {
	sessions, err := a.store.Moderate(r.Context(), actor, target, action, blockIP)
	if err != nil {
		resultError(w, err)
		return false
	}
	a.broadcast("members.changed", struct{}{})
	if a.config.Media != nil {
		a.config.Media.FinishRevocations(r.Context(), sessions)
	}
	return true
}
