package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
	"uuid"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/MrDeex1k/Yapper/server/internal/identity"
	"github.com/MrDeex1k/Yapper/server/internal/media"
	"github.com/coder/websocket"
)

type CommunityConfig struct {
	Media        *media.Service
	Origin       string
	SetupToken   string
	SetupExpires time.Time
}
type principal struct {
	participant community.Participant
	account     *identity.Account
}
type ticket struct {
	who     principal
	expires time.Time
}
type stream struct {
	who        principal
	connection *websocket.Conn
	queue      chan []byte
}
type CommunityAPI struct {
	store    *community.Store
	verifier *identity.Verifier
	auth     *identity.AuthClient
	config   CommunityConfig
	mux      *http.ServeMux
	mu       sync.Mutex
	tickets  map[string]ticket
	streams  map[*stream]struct{}
}

func NewCommunity(store *community.Store, verifier *identity.Verifier, auth *identity.AuthClient, config CommunityConfig) (*CommunityAPI, error) {
	u, err := url.Parse(config.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Scheme != "https" && (u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost")) {
		return nil, errors.New("invalid application origin")
	}
	if len(config.SetupToken) < 32 || config.SetupExpires.IsZero() {
		return nil, errors.New("setup token and expiry required")
	}
	a := &CommunityAPI{store: store, verifier: verifier, auth: auth, config: config, mux: http.NewServeMux(), tickets: map[string]ticket{}, streams: map[*stream]struct{}{}}
	a.mux.HandleFunc("POST /api/v1/voice/grant", a.voiceGrant)
	a.mux.HandleFunc("POST /api/v1/voice/leave", a.voiceLeave)
	if config.Media != nil {
		a.mux.Handle("/livekit/", config.Media)
	}
	a.mux.HandleFunc("GET /api/v1/state", a.state)
	a.mux.HandleFunc("POST /api/v1/setup", a.setup)
	a.mux.HandleFunc("POST /api/v1/guests", a.join)
	a.mux.HandleFunc("GET /api/v1/me", a.me)
	a.mux.HandleFunc("POST /api/v1/invitations", a.invite)
	a.mux.HandleFunc("POST /api/v1/participants/{id}/ban", a.ban)
	a.mux.HandleFunc("GET /api/v1/channels/{id}/messages", a.history)
	a.mux.HandleFunc("POST /api/v1/channels/{id}/messages", a.send)
	a.mux.HandleFunc("POST /api/v1/events/ticket", a.issueTicket)
	a.mux.HandleFunc("GET /api/v1/events", a.events)
	a.mux.Handle("/", New(verifier))
	return a, nil
}
func (a *CommunityAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("Origin") != a.config.Origin {
		fail(w, http.StatusForbidden, "origin_denied")
		return
	}
	a.mux.ServeHTTP(w, r)
}
func fail(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"code": code})
}
func resultError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, community.ErrDenied), errors.Is(err, identity.ErrUnauthorized):
		fail(w, 403, "access_denied")
	case errors.Is(err, community.ErrConflict):
		fail(w, 409, "conflict")
	case errors.Is(err, community.ErrNotConfigured):
		fail(w, 409, "not_configured")
	default:
		fail(w, 503, "service_unavailable")
	}
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || params["charset"] != "" && strings.ToLower(params["charset"]) != "utf-8" || r.Header.Get("Content-Encoding") != "" {
		fail(w, 415, "unsupported_media")
		return false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		fail(w, 413, "request_too_large")
		return false
	}
	if err = json.Unmarshal(body, value, json.RejectUnknownMembers(true)); err != nil {
		fail(w, 400, "invalid_request")
		return false
	}
	return true
}
func validText(value string, min, max int) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return false
	}
	n := utf8.RuneCountInString(value)
	if n < min || n > max {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}
func validID(value string) bool {
	u, err := uuid.Parse(value)
	return err == nil && u.String() == value && u != uuid.Nil()
}
func (a *CommunityAPI) authenticate(r *http.Request) (principal, error) {
	if raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		account, err := a.verifier.VerifyAccount(r.Context(), raw)
		if err != nil {
			return principal{}, err
		}
		if err = a.auth.Active(r.Context(), account); err != nil {
			return principal{}, err
		}
		p, err := a.store.AccountIdentity(r.Context(), account.Subject)
		return principal{participant: p, account: &account}, err
	}
	cookie, err := r.Cookie(a.cookieName())
	if err != nil {
		return principal{}, community.ErrDenied
	}
	p, err := a.store.GuestIdentity(r.Context(), cookie.Value)
	return principal{participant: p}, err
}
func (a *CommunityAPI) require(w http.ResponseWriter, r *http.Request) (principal, bool) {
	p, err := a.authenticate(r)
	if err != nil {
		resultError(w, err)
		return principal{}, false
	}
	return p, true
}
func (a *CommunityAPI) cookieName() string {
	if strings.HasPrefix(a.config.Origin, "https:") {
		return "__Host-yapper_guest"
	}
	return "yapper_guest"
}
func (a *CommunityAPI) state(w http.ResponseWriter, r *http.Request) {
	state, err := a.store.State(r.Context())
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, state)
}
func (a *CommunityAPI) setup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	if time.Now().After(a.config.SetupExpires) || subtle.ConstantTimeCompare([]byte(body.Token), []byte(a.config.SetupToken)) != 1 {
		fail(w, 403, "setup_denied")
		return
	}
	if !validText(body.Name, 1, 64) || !validText(body.Username, 3, 32) || len(body.Password) < 12 || len(body.Password) > 128 {
		fail(w, 400, "invalid_request")
		return
	}
	err := a.store.Setup(r.Context(), body.Name, body.Username, func(ctx context.Context) (string, error) { return a.auth.Provision(ctx, body.Username, body.Password) })
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 201, map[string]bool{"configured": true})
}
func (a *CommunityAPI) join(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Nickname   string `json:"nickname"`
		Invitation string `json:"invitation"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validText(body.Nickname, 1, 32) {
		fail(w, 400, "invalid_nickname")
		return
	}
	// Reopening or retrying admission retains a valid existing identity.
	if cookie, err := r.Cookie(a.cookieName()); err == nil {
		if p, err := a.store.GuestIdentity(r.Context(), cookie.Value); err == nil {
			writeJSON(w, 200, p)
			return
		}
	}
	p, secret, err := a.store.Guest(r.Context(), body.Nickname, body.Invitation)
	if err != nil {
		resultError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: a.cookieName(), Value: secret, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(a.config.Origin, "https:"), SameSite: http.SameSiteStrictMode, MaxAge: 365 * 24 * 3600})
	writeJSON(w, 201, p)
}
func (a *CommunityAPI) me(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	channels, err := a.store.Channels(r.Context())
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Participant community.Participant `json:"participant"`
		Channels    []community.Channel   `json:"channels"`
	}{p.participant, channels})
}
func (a *CommunityAPI) invite(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	token, err := a.store.Invite(r.Context(), p.participant.ID)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"token": token})
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
	if err := a.store.Ban(r.Context(), p.participant.ID, id); err != nil {
		resultError(w, err)
		return
	}
	a.disconnect(id)
	if a.config.Media != nil {
		if err := a.config.Media.Revoke(r.Context(), id); err != nil {
			resultError(w, err)
			return
		}
	}
	writeJSON(w, 200, map[string]bool{"banned": true})
}
func (a *CommunityAPI) history(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.require(w, r); !ok {
		return
	}
	id := r.PathValue("id")
	after, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if r.URL.Query().Get("after") == "" {
		after = 0
		err = nil
	}
	if !validID(id) || err != nil || after < 0 {
		fail(w, 400, "invalid_request")
		return
	}
	messages, err := a.store.History(r.Context(), id, after)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"messages": messages})
}
func (a *CommunityAPI) send(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body struct {
		RequestID string `json:"requestId"`
		Body      string `json:"body"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validID(id) || !validID(body.RequestID) || !validText(body.Body, 1, 2000) {
		fail(w, 400, "invalid_message")
		return
	}
	m, fresh, err := a.store.Send(r.Context(), p.participant.ID, id, body.RequestID, body.Body)
	if err != nil {
		resultError(w, err)
		return
	}
	if fresh {
		a.broadcast("message.created", m)
	}
	writeJSON(w, 200, m)
}
func randomToken() string { var b [32]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func (a *CommunityAPI) issueTicket(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for k, t := range a.tickets {
		if t.expires.Before(now) {
			delete(a.tickets, k)
		}
	}
	if len(a.tickets) >= 4096 {
		fail(w, 429, "try_later")
		return
	}
	token := randomToken()
	a.tickets[token] = ticket{p, now.Add(10 * time.Second)}
	writeJSON(w, 201, map[string]string{"ticket": token})
}
func (a *CommunityAPI) current(ctx context.Context, p principal) error {
	if _, err := a.store.Participant(ctx, p.participant.ID); err != nil {
		return err
	}
	if p.account != nil {
		if p.account.ExpiresAt == nil || time.Now().After(p.account.ExpiresAt.Time) {
			return identity.ErrUnauthorized
		}
		return a.auth.Active(ctx, *p.account)
	}
	return nil
}
func (a *CommunityAPI) events(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != a.config.Origin {
		fail(w, 403, "origin_denied")
		return
	}
	var token string
	for _, protocol := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(protocol), "yapper.ticket."); ok {
			token = value
		}
	}
	a.mu.Lock()
	t, ok := a.tickets[token]
	delete(a.tickets, token)
	a.mu.Unlock()
	if !ok || time.Now().After(t.expires) {
		fail(w, 403, "access_denied")
		return
	}
	if err := a.current(r.Context(), t.who); err != nil {
		resultError(w, err)
		return
	}
	origin, _ := url.Parse(a.config.Origin)
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"yapper.v1"}, OriginPatterns: []string{origin.Host}})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1024)
	ctx := conn.CloseRead(r.Context())
	s := &stream{who: t.who, connection: conn, queue: make(chan []byte, 32)}
	initial, _ := json.Marshal(map[string]any{"version": 1, "type": "ready", "payload": map[string]bool{"reconcile": true}})
	s.queue <- initial
	a.mu.Lock()
	a.streams[s] = struct{}{}
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.streams, s); a.mu.Unlock() }()
	// Recheck after registration so a ban racing the handshake cannot escape disconnect.
	if err = a.current(ctx, t.who); err != nil {
		return
	}
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case data := <-s.queue:
			if err = a.current(ctx, t.who); err != nil {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Write(writeCtx, websocket.MessageText, data)
			cancel()
			if err != nil {
				return
			}
		case <-timer.C:
			checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err = a.current(checkCtx, t.who)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
func (a *CommunityAPI) broadcast(kind string, payload any) {
	data, err := json.Marshal(map[string]any{"version": 1, "type": kind, "payload": payload})
	if err != nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for s := range a.streams {
		select {
		case s.queue <- data:
		default:
			_ = s.connection.CloseNow()
			delete(a.streams, s)
		}
	}
}
func (a *CommunityAPI) disconnect(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for s := range a.streams {
		if s.who.participant.ID == id {
			_ = s.connection.CloseNow()
			delete(a.streams, s)
		}
	}
}
func (a *CommunityAPI) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for s := range a.streams {
		_ = s.connection.CloseNow()
		delete(a.streams, s)
	}
}

func (a *CommunityAPI) voiceGrant(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	if a.config.Media == nil {
		fail(w, 503, "media_unavailable")
		return
	}
	var body struct {
		ChannelID string `json:"channelId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validID(body.ChannelID) {
		fail(w, 400, "invalid_request")
		return
	}
	var subject, sessionID string
	if p.account != nil {
		subject = p.account.Subject
		sessionID = p.account.SessionID
	}
	grant, err := a.config.Media.Grant(r.Context(), p.participant.ID, body.ChannelID, subject, sessionID)
	if err != nil {
		resultError(w, err)
		return
	}
	writeJSON(w, 201, grant)
}
func (a *CommunityAPI) voiceLeave(w http.ResponseWriter, r *http.Request) {
	p, ok := a.require(w, r)
	if !ok {
		return
	}
	var body struct {
		Identity string `json:"identity"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Identity) > 128 {
		fail(w, 400, "invalid_request")
		return
	}
	if a.config.Media != nil {
		var err error
		if body.Identity == "" {
			err = a.config.Media.Revoke(r.Context(), p.participant.ID)
		} else {
			err = a.config.Media.Leave(r.Context(), p.participant.ID, body.Identity)
		}
		if err != nil {
			resultError(w, err)
			return
		}
	}
	writeJSON(w, 200, map[string]bool{"left": true})
}
