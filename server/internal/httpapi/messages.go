package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/MrDeex1k/Yapper/server/internal/community"
)

func (a *CommunityAPI) messageRoutes() {
	a.mux.HandleFunc("GET /api/v1/channels/{id}/messages", a.history)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/messages", a.send)
	a.mux.HandleFunc("GET /api/v1/channels/{id}/timeline", a.timeline)
	a.mux.HandleFunc("GET /api/v1/channels/{id}/messages/changes", a.messageChanges)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/messages/{message}/edit", a.editMessage)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/messages/{message}/delete", a.deleteMessage)
	a.mux.HandleFunc("GET /api/v1/message-retention", a.messageRetention)
	a.mux.HandleFunc("POST /api/v1/message-retention", a.setMessageRetention)
}

func historyCursor(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	raw := r.URL.Query().Get(name)
	var cursor int64
	var err error
	if raw != "" {
		cursor, err = strconv.ParseInt(raw, 10, 64)
	}
	if !validID(r.PathValue("id")) || err != nil || cursor < 0 {
		fail(w, 400, "invalid_request")
		return 0, false
	}
	return cursor, true
}

func (a *CommunityAPI) timeline(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.require(w, r); !ok {
		return
	}
	before, ok := historyCursor(w, r, "before")
	if !ok {
		return
	}
	result, err := a.store.HistoryPage(r.Context(), r.PathValue("id"), before)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, result)
}

func (a *CommunityAPI) messageChanges(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.require(w, r); !ok {
		return
	}
	after, ok := historyCursor(w, r, "after")
	if !ok {
		return
	}
	changes, err := a.store.MessageChanges(r.Context(), r.PathValue("id"), after)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Changes []community.MessageChange `json:"changes"`
	}{changes})
}

func (a *CommunityAPI) editMessage(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	channel, id := r.PathValue("id"), r.PathValue("message")
	var input struct {
		Body     string `json:"body"`
		Revision *int64 `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !validID(channel) || !validID(id) || !validText(input.Body, 1, 2000) || input.Revision == nil || *input.Revision < 0 {
		fail(w, 400, "invalid_message")
		return
	}
	changed, err := a.store.EditMessage(r.Context(), p.participant.ID, channel, id, input.Body, *input.Revision)
	a.messageResult(w, channel, changed, err)
}

func (a *CommunityAPI) deleteMessage(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	channel, id := r.PathValue("id"), r.PathValue("message")
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	if !validID(channel) || !validID(id) {
		fail(w, 400, "invalid_request")
		return
	}
	changed, err := a.store.DeleteMessage(r.Context(), p.participant.ID, channel, id)
	a.messageResult(w, channel, changed, err)
}

func (a *CommunityAPI) messageResult(w http.ResponseWriter, channel string, changed bool, err error) {
	if err != nil {
		resultError(w, err)
		return
	}
	if changed {
		a.messagesChanged(channel)
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

func (a *CommunityAPI) messagesChanged(channel string) {
	a.broadcast("messages.changed", map[string]string{"channelId": channel})
}

func (a *CommunityAPI) messageRetention(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	days, err := a.store.MessageRetention(r.Context(), p.participant.ID)
	a.retentionResult(w, days, err)
}

func (a *CommunityAPI) setMessageRetention(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	var input struct {
		Days *int `json:"days"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Days == nil || *input.Days < 0 || *input.Days > community.MaxRetentionDays {
		fail(w, 400, "invalid_request")
		return
	}
	err := a.store.SetMessageRetention(r.Context(), p.participant.ID, *input.Days)
	a.retentionResult(w, *input.Days, err)
}

func (a *CommunityAPI) retentionResult(w http.ResponseWriter, days int, err error) {
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string]int{"days": days})
}

// RetainMessages runs from startup and yields between bounded cleanup passes.
func (a *CommunityAPI) RetainMessages(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		a.expireMessages(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (a *CommunityAPI) expireMessages(ctx context.Context) {
	pass, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for pass.Err() == nil {
		channel, err := a.store.ExpireMessages(pass)
		if err != nil {
			if ctx.Err() == nil {
				slog.Warn("message retention pass interrupted")
			}
			return
		}
		if channel == "" {
			return
		}
		a.messagesChanged(channel)
	}
}
