// Package media gates every public LiveKit signaling handshake against current membership.
package media

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/MrDeex1k/Yapper/server/internal/identity"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/twitchtv/twirp"
)

type Service struct {
	store               *community.Store
	auth                *identity.AuthClient
	key, secret, origin string
	target              *url.URL
	room                *lksdk.RoomServiceClient
	mu                  sync.Mutex
	connections         map[string]map[*trackedBody]struct{}
}
type trackedBody struct {
	io.ReadWriteCloser
	service  *Service
	identity string
	once     sync.Once
}

func (b *trackedBody) Close() error {
	err := b.ReadWriteCloser.Close()
	b.once.Do(func() {
		b.service.mu.Lock()
		defer b.service.mu.Unlock()
		delete(b.service.connections[b.identity], b)
		if len(b.service.connections[b.identity]) == 0 {
			delete(b.service.connections, b.identity)
		}
	})
	return err
}

type Grant struct {
	URL       string `json:"url"`
	Token     string `json:"token"`
	Identity  string `json:"identity"`
	ChannelID string `json:"channelId"`
}

func New(store *community.Store, auth *identity.AuthClient, endpoint, key, secret, origin string) (*Service, error) {
	target, err := url.Parse(endpoint)
	if err != nil || target.Host == "" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || target.Path != "" || (target.Scheme != "http" && target.Scheme != "https") || key == "" || len(secret) < 32 {
		return nil, errors.New("invalid media configuration")
	}
	return &Service{store: store, auth: auth, key: key, secret: secret, origin: origin, target: target, room: lksdk.NewRoomServiceClient(endpoint, key, secret), connections: map[string]map[*trackedBody]struct{}{}}, nil
}
func (s *Service) Grant(ctx context.Context, id, channel, subject, sessionID string) (Grant, error) {
	m, err := s.store.StartVoice(ctx, id, channel, subject, sessionID, s.remove)
	if err != nil {
		return Grant{}, err
	}
	grant := &lkauth.VideoGrant{RoomJoin: true, Room: m.ChannelID, CanPublish: new(true), CanSubscribe: new(true), CanPublishData: new(false), CanUpdateOwnMetadata: new(false)}
	grant.SetCanPublishSources([]livekit.TrackSource{livekit.TrackSource_MICROPHONE})
	token, err := lkauth.NewAccessToken(s.key, s.secret).SetIdentity(m.Identity).SetName(m.Nickname).SetVideoGrant(grant).SetValidFor(60 * time.Second).ToJWT()
	if err != nil {
		return Grant{}, err
	}
	return Grant{URL: strings.Replace(s.origin, "http", "ws", 1) + "/livekit", Token: token, Identity: m.Identity, ChannelID: m.ChannelID}, nil
}
func (s *Service) Revoke(ctx context.Context, id string) error {
	m, err := s.store.RevokeVoice(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = s.remove(ctx, m); err != nil {
		return err
	}
	return s.store.ForgetVoice(ctx, m.Identity)
}
func (s *Service) remove(ctx context.Context, m community.MediaSession) error {
	s.mu.Lock()
	connections := s.connections[m.Identity]
	delete(s.connections, m.Identity)
	s.mu.Unlock()
	for connection := range connections {
		_ = connection.Close()
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := s.room.RemoveParticipant(bounded, &livekit.RoomParticipantIdentity{Room: m.ChannelID, Identity: m.Identity})
	if problem, ok := errors.AsType[twirp.Error](err); ok && problem.Code() == twirp.NotFound {
		return nil
	}
	return err
}
func (s *Service) current(ctx context.Context, mediaIdentity string) (community.MediaSession, error) {
	m, err := s.store.VoiceSession(ctx, mediaIdentity)
	if err != nil {
		return m, err
	}
	if m.AuthSessionID != "" {
		err = s.auth.Active(ctx, identity.Account{RegisteredClaims: jwt.RegisteredClaims{Subject: m.AuthSubject}, SessionID: m.AuthSessionID})
	}
	return m, err
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || r.Header.Get("Origin") != s.origin {
		http.Error(w, "access denied", 403)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/livekit")
	switch path {
	case "/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate":
	default:
		http.NotFound(w, r)
		return
	}
	raw := r.URL.Query().Get("access_token")
	if len(raw) == 0 || len(raw) > 8192 {
		http.Error(w, "access denied", 403)
		return
	}
	var claims struct {
		jwt.RegisteredClaims
		Video *lkauth.VideoGrant `json:"video"`
	}
	token, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return []byte(s.secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(s.key), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Video == nil || !claims.Video.RoomJoin {
		http.Error(w, "access denied", 403)
		return
	}
	m, err := s.current(r.Context(), claims.Subject)
	if err != nil || m.ChannelID != claims.Video.Room {
		http.Error(w, "access denied", 403)
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(s.target)
			p.Out.URL.Path = path
			p.Out.URL.RawPath = ""
			p.Out.Header.Del("Cookie")
			p.Out.Header.Del("Authorization")
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) { http.Error(w, "media unavailable", 502) },
		ModifyResponse: func(response *http.Response) error {
			if response.StatusCode != http.StatusSwitchingProtocols {
				return nil
			}
			body, ok := response.Body.(io.ReadWriteCloser)
			if !ok {
				return errors.New("invalid media upgrade")
			}
			// Register and recheck under the same lock used by moderation. A handshake
			// authorized before a concurrent ban cannot become an untracked live socket.
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, err := s.current(r.Context(), m.Identity); err != nil {
				_ = body.Close()
				return errors.New("media membership revoked")
			}
			tracked := &trackedBody{ReadWriteCloser: body, service: s, identity: m.Identity}
			if s.connections[m.Identity] == nil {
				s.connections[m.Identity] = map[*trackedBody]struct{}{}
			}
			s.connections[m.Identity][tracked] = struct{}{}
			response.Body = tracked
			return nil
		},
	}
	proxy.ServeHTTP(w, r)
}

// Reconcile retries incomplete moderation and expires registered media sessions.
func (s *Service) Reconcile(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reconcileOnce(ctx)
		}
	}
}
func (s *Service) reconcileOnce(ctx context.Context) {
	list, cancel := context.WithTimeout(ctx, 3*time.Second)
	removals, err := s.store.PendingVoiceRemovals(list)
	cancel()
	if err == nil {
		for _, m := range removals {
			item, done := context.WithTimeout(ctx, 6*time.Second)
			if s.remove(item, m) == nil {
				_ = s.store.ForgetVoiceRemoval(item, m.Identity)
			}
			done()
		}
	}
	list, cancel = context.WithTimeout(ctx, 3*time.Second)
	sessions, err := s.store.AllVoiceSessions(list)
	cancel()
	if err != nil {
		return
	}
	for _, m := range sessions {
		if ctx.Err() != nil {
			return
		}
		item, done := context.WithTimeout(ctx, 3*time.Second)
		_, err := s.current(item, m.Identity)
		done()
		if !errors.Is(err, community.ErrDenied) && !errors.Is(err, identity.ErrUnauthorized) {
			continue
		}
		cleanup, cancel := context.WithTimeout(ctx, 6*time.Second)
		stale, err := s.store.RevokeVoiceIdentity(cleanup, m.Identity)
		if err == nil && s.remove(cleanup, stale) == nil {
			_ = s.store.ForgetVoice(cleanup, stale.Identity)
		}
		cancel()
	}
}

func (s *Service) Close() {
	s.mu.Lock()
	connections := s.connections
	s.connections = map[string]map[*trackedBody]struct{}{}
	s.mu.Unlock()
	for _, set := range connections {
		for c := range set {
			_ = c.Close()
		}
	}
}

func (s *Service) Leave(ctx context.Context, id, mediaIdentity string) error {
	m, err := s.store.RevokeOwnedVoice(ctx, id, mediaIdentity)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = s.remove(ctx, m); err != nil {
		return err
	}
	return s.store.ForgetVoice(ctx, m.Identity)
}
