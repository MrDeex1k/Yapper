package httpapi

import (
	"net/http"
	"strings"

	"github.com/MrDeex1k/Yapper/server/internal/community"
)

func (a *CommunityAPI) catalogRoutes() {
	a.mux.HandleFunc("POST /api/v1/categories", a.saveCategory)
	a.mux.HandleFunc("POST /api/v1/categories/{id}", a.saveCategory)
	a.mux.HandleFunc("POST /api/v1/categories/{id}/move", a.moveCategory)
	a.mux.HandleFunc("POST /api/v1/channels", a.saveChannel)
	a.mux.HandleFunc("POST /api/v1/channels/{id}", a.saveChannel)
	a.mux.HandleFunc("PATCH /api/v1/channels/{id}", a.patchChannel)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/move", a.moveChannel)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/archive", a.archiveChannel)
}

func validCatalogName(value string) bool {
	return validText(value, 1, 64) && !strings.ContainsAny(value, "\n\t")
}

func (a *CommunityAPI) saveCategory(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	if id != "" && !validID(id) || !validCatalogName(body.Name) {
		fail(w, 400, "invalid_request")
		return
	}
	a.catalogResult(w, a.store.SaveCategory(r.Context(), p.participant.ID, id, body.Name))
}

func (a *CommunityAPI) saveChannel(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		Name       string `json:"name"`
		Kind       string `json:"kind"`
		CategoryID string `json:"categoryId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if id != "" && !validID(id) || !validCatalogName(body.Name) || body.CategoryID != "" && !validID(body.CategoryID) ||
		id == "" && body.Kind != "text" && body.Kind != "voice" || id != "" && body.Kind != "" {
		fail(w, 400, "invalid_request")
		return
	}
	a.catalogResult(w, a.store.SaveChannel(r.Context(), p.participant.ID, id, body.Name, body.Kind, body.CategoryID))
}

func (a *CommunityAPI) patchChannel(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		Name       *string `json:"name"`
		CategoryID *string `json:"categoryId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validID(id) || body.Name == nil && body.CategoryID == nil ||
		body.Name != nil && !validCatalogName(*body.Name) ||
		body.CategoryID != nil && *body.CategoryID != "" && !validID(*body.CategoryID) {
		fail(w, 400, "invalid_request")
		return
	}
	a.catalogResult(w, a.store.PatchChannel(r.Context(), p.participant.ID, id, body.Name, body.CategoryID))
}

func moveInput(w http.ResponseWriter, r *http.Request) (int, bool) {
	var body struct {
		Direction int `json:"direction"`
	}
	if !decode(w, r, &body) {
		return 0, false
	}
	if !validID(r.PathValue("id")) || body.Direction != -1 && body.Direction != 1 {
		fail(w, 400, "invalid_request")
		return 0, false
	}
	return body.Direction, true
}

func (a *CommunityAPI) moveCategory(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	if direction, ok := moveInput(w, r); ok {
		a.catalogResult(w, a.store.MoveCategory(r.Context(), p.participant.ID, r.PathValue("id"), direction))
	}
}

func (a *CommunityAPI) moveChannel(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	if direction, ok := moveInput(w, r); ok {
		a.catalogResult(w, a.store.MoveChannel(r.Context(), p.participant.ID, r.PathValue("id"), direction))
	}
}

func (a *CommunityAPI) archiveChannel(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		fail(w, 400, "invalid_request")
		return
	}
	a.catalogResult(w, a.store.ArchiveChannel(r.Context(), p.participant.ID, id))
}

func (a *CommunityAPI) catalogResult(w http.ResponseWriter, err error) {
	if err != nil {
		resultError(w, err)
		return
	}
	a.broadcast("catalog.changed", struct{}{})
	writeJSON(w, 200, struct {
		Saved bool `json:"saved"`
	}{true})
}

type currentUser struct {
	Participant community.Participant `json:"participant"`
	Account     bool                  `json:"account"`
	community.Catalog
}
