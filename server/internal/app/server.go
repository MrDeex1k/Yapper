package app

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"sync/atomic"
)

var Version = "0.4.0-dev"

type Server struct {
	uploadSlots     chan struct{}
	Files           *FileStore
	Media           *Media
	eventsHub       *hub
	authLimit       authLimiter
	BootstrapToken  string
	DB              *pgxpool.Pool
	ready           atomic.Bool
	CheckDependency func(context.Context) error
}

func NewServer() *Server {
	s := &Server{eventsHub: newHub(), uploadSlots: make(chan struct{}, 4)}
	s.ready.Store(true)
	return s
}
func (s *Server) Drain() { s.ready.Store(false); s.eventsHub.revoke("", "") }
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, map[string]string{"status": "alive"}) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if !s.ready.Load() {
			JSON(w, 503, map[string]string{"status": "draining"})
			return
		}
		if s.CheckDependency != nil {
			if err := s.CheckDependency(r.Context()); err != nil {
				JSON(w, 503, map[string]string{"status": "dependency_unavailable"})
				return
			}
		}
		JSON(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /api/v1/info", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"name": "Yapper", "version": Version, "protocol": 1})
	})
	if s.DB != nil {
		mux.HandleFunc("PATCH /api/v1/channels/{channel}/messages/{message}", s.authenticated(s.editMessage))
		mux.HandleFunc("GET /api/v1/search", s.authenticated(s.search))
		mux.HandleFunc("POST /api/v1/channels/{channel}/files", s.authenticated(s.upload))
		mux.HandleFunc("GET /api/v1/files/{file}/info", s.authenticated(s.download))
		mux.HandleFunc("GET /api/v1/files/{file}", s.authenticated(s.download))
		mux.HandleFunc("GET /api/v1/admin/status", s.authenticated(s.status))
		mux.HandleFunc("GET /api/v1/admin/users", s.authenticated(s.users))
		mux.HandleFunc("PATCH /api/v1/admin/users/{user}", s.authenticated(s.updateUser))
		mux.HandleFunc("DELETE /api/v1/channels/{channel}/messages/{message}", s.authenticated(s.deleteMessage))
		mux.HandleFunc("DELETE /api/v1/channels/{channel}/voice", s.authenticated(s.voiceLeave))
		mux.HandleFunc("POST /api/v1/channels/{channel}/voice", s.authenticated(s.voiceJoin))
		mux.HandleFunc("GET /api/v1/channels/{channel}/participants", s.authenticated(s.voiceParticipants))
		mux.HandleFunc("PUT /api/v1/channels/{channel}/members/{user}", s.authenticated(s.membership))
		mux.HandleFunc("DELETE /api/v1/channels/{channel}/members/{user}", s.authenticated(s.membership))
		mux.HandleFunc("GET /api/v1/events", s.events)
		mux.HandleFunc("GET /api/v1/channels/{channel}/messages", s.authenticated(s.messages))
		mux.HandleFunc("POST /api/v1/channels/{channel}/messages", s.authenticated(s.sendMessage))
		mux.HandleFunc("GET /api/v1/channels", s.authenticated(s.channels))
		mux.HandleFunc("POST /api/v1/channels", s.authenticated(s.createChannel))
		mux.HandleFunc("POST /api/v1/auth/bootstrap", s.authLimit.wrap(s.bootstrap))
		mux.HandleFunc("POST /api/v1/auth/login", s.authLimit.wrap(s.login))
		mux.HandleFunc("POST /api/v1/auth/register", s.authLimit.wrap(s.register))
		mux.HandleFunc("POST /api/v1/auth/logout", s.authenticated(s.logout))
		mux.HandleFunc("POST /api/v1/auth/invites", s.authenticated(s.createInvite))
		mux.HandleFunc("GET /api/v1/auth/me", s.authenticated(func(w http.ResponseWriter, r *http.Request, u User) { JSON(w, 200, u) }))
	}
	return desktopCORS(mux)
}
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
