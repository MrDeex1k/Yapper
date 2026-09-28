package app

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type attempt struct {
	count int
	until time.Time
}
type authLimiter struct {
	mu      sync.Mutex
	entries map[string]attempt
	slots   chan struct{}
}

func (l *authLimiter) wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		l.mu.Lock()
		if l.entries == nil {
			l.entries = make(map[string]attempt)
			l.slots = make(chan struct{}, 4)
		}
		now := time.Now()
		for key, value := range l.entries {
			if now.After(value.until) {
				delete(l.entries, key)
			}
		}
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		item := l.entries[host]
		if item.until.IsZero() {
			item.until = now.Add(time.Minute)
		}
		item.count++
		allowed := item.count <= 20 && len(l.entries) < 4096
		if _, exists := l.entries[host]; exists || len(l.entries) < 4096 {
			l.entries[host] = item
		}
		l.mu.Unlock()
		if !allowed {
			w.Header().Set("Retry-After", "60")
			fail(w, 429, "rate_limit", "Too many attempts. Try again later.")
			return
		}
		select {
		case l.slots <- struct{}{}:
			defer func() { <-l.slots }()
			next(w, r)
		default:
			fail(w, 429, "busy", "Authentication is busy. Try again later.")
		}
	}
}
