package app

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
)

var Version = "0.1.0-dev"

type Server struct {
	ready           atomic.Bool
	CheckDependency func(context.Context) error
}

func NewServer() *Server { s := &Server{}; s.ready.Store(true); return s }
func (s *Server) Drain() { s.ready.Store(false) }
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
		if !s.ready.Load() {
			JSON(w, 503, map[string]string{"status": "draining"})
			return
		}
		JSON(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /api/v1/info", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"name": "Yapper", "version": Version, "protocol": 1})
	})
	return mux
}
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
