package app

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type subscriber struct {
	userID, channelID string
	events            chan Event
	cancel            context.CancelFunc
}
type hub struct {
	mu      sync.Mutex
	clients map[*subscriber]struct{}
}

func newHub() *hub { return &hub{clients: make(map[*subscriber]struct{})} }
func (h *hub) add(c *subscriber) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	count := 0
	for client := range h.clients {
		if client.userID == c.userID {
			count++
		}
	}
	if len(h.clients) >= 2048 || count >= 8 {
		return false
	}
	h.clients[c] = struct{}{}
	return true
}
func (h *hub) remove(c *subscriber) { h.mu.Lock(); defer h.mu.Unlock(); delete(h.clients, c) }
func (h *hub) publish(channel, kind string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	event := Event{Protocol: 1, ID: rand.Text(), Type: kind, ChannelID: channel}
	for c := range h.clients {
		if c.channelID != channel {
			continue
		}
		select {
		case c.events <- event:
		default:
			c.cancel()
		}
	}
}
func (h *hub) revoke(user, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if (user == "" || c.userID == user) && (channel == "" || c.channelID == channel) {
			c.cancel()
		}
	}
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(4096)
	authCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	_, data, err := conn.Read(authCtx)
	cancel()
	if err != nil {
		return
	}
	var auth struct {
		Token     string `json:"token"`
		ChannelID string `json:"channel_id"`
	}
	if json.Unmarshal(data, &auth) != nil || len(auth.Token) > 256 {
		_ = conn.Close(websocket.StatusPolicyViolation, "Invalid authentication")
		return
	}
	user, err := s.sessionUser(r, auth.Token)
	if err != nil || !s.canAccess(r, user, auth.ChannelID) {
		_ = conn.Close(websocket.StatusPolicyViolation, "Access denied")
		return
	}
	ctx, cancel := context.WithCancel(conn.CloseRead(r.Context()))
	defer cancel()
	client := &subscriber{user.ID, auth.ChannelID, make(chan Event, 32), cancel}
	if !s.eventsHub.add(client) {
		_ = conn.Close(websocket.StatusTryAgainLater, "Connection limit")
		return
	}
	defer s.eventsHub.remove(client)
	client.events <- Event{Protocol: 1, ID: rand.Text(), Type: "sync", ChannelID: auth.ChannelID}
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-client.events:
			current, err := s.sessionUser(r, auth.Token)
			if err != nil || !s.canAccess(r, current, auth.ChannelID) {
				_ = conn.Close(websocket.StatusPolicyViolation, "Access revoked")
				return
			}
			data, err := json.Marshal(event)
			if err != nil {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Write(writeCtx, websocket.MessageText, data)
			cancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			current, err := s.sessionUser(r, auth.Token)
			if err != nil || !s.canAccess(r, current, auth.ChannelID) {
				_ = conn.Close(websocket.StatusPolicyViolation, "Access revoked")
				return
			}
			pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
