package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxRateKeys = 16384

type requestLimit struct {
	mu      sync.Mutex
	started time.Time
	counts  map[string]int
}

// take allows a bounded number of requests per key in a one-minute window.
func (l *requestLimit) take(key string, limit int, now time.Time) (allowed bool, retry int) {
	if limit == 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.started.IsZero() || now.Sub(l.started) >= time.Minute {
		l.started = now
		if l.counts == nil {
			l.counts = make(map[string]int)
		} else {
			clear(l.counts)
		}
	}
	count, found := l.counts[key]
	if count >= limit || !found && len(l.counts) >= maxRateKeys {
		return false, min(60, max(1, int((time.Minute-now.Sub(l.started)+time.Second-1)/time.Second)))
	}
	l.counts[key] = count + 1
	return true, 0
}

func allowRequest(w http.ResponseWriter, limit *requestLimit, key string, perMinute int) bool {
	allowed, retry := limit.take(key, perMinute, time.Now())
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		fail(w, http.StatusTooManyRequests, "try_later")
	}
	return allowed
}

type loggedResponse struct {
	http.ResponseWriter
	status int
}

func (w *loggedResponse) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (a *CommunityAPI) serveRequest(w http.ResponseWriter, r *http.Request) {
	id := randomToken()
	w.Header().Set("X-Request-ID", id)
	// Keep streaming and upgrade handlers on the original ResponseWriter.
	if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.Path, "/api/v1/") {
		a.mux.ServeHTTP(w, r)
		return
	}
	logged := &loggedResponse{ResponseWriter: w}
	a.mux.ServeHTTP(logged, r)
	if logged.status >= 400 {
		slog.Warn("request rejected", "request_id", id, "route", r.Pattern, "status", logged.status)
	}
}

func (a *CommunityAPI) diagnostics(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	var grants int
	ready := a.store.Pool.QueryRow(ctx, "SELECT count(*) FROM media_sessions WHERE NOT revoked").Scan(&grants) == nil
	a.mu.Lock()
	streams := len(a.streams)
	a.mu.Unlock()
	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, struct {
		Ready        bool `json:"ready"`
		Database     bool `json:"database"`
		EventStreams int  `json:"eventStreams"`
		ActiveGrants int  `json:"activeGrants"`
	}{ready, ready, streams, grants})
}
