// Package media gates every public LiveKit signaling handshake against current membership.
package media

import (
	"context"
	"errors"
	"io"
	"net"
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
	closed              bool
}

type trackedBody struct {
	io.ReadWriteCloser
	closeOnce func() error
}

func (b *trackedBody) Close() error { return b.closeOnce() }

func (s *Service) trackConnection(identity string, body io.ReadWriteCloser) (*trackedBody, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, net.ErrClosed
	}
	tracked := &trackedBody{ReadWriteCloser: body}
	tracked.closeOnce = sync.OnceValue(func() error {
		err := body.Close()
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.connections[identity], tracked)
		if len(s.connections[identity]) == 0 {
			delete(s.connections, identity)
		}
		return err
	})
	if s.connections[identity] == nil {
		s.connections[identity] = map[*trackedBody]struct{}{}
	}
	s.connections[identity][tracked] = struct{}{}
	return tracked, nil
}

type Grant struct {
	URL        string `json:"url"`
	Token      string `json:"token"`
	Identity   string `json:"identity"`
	ChannelID  string `json:"channelId"`
	CanPublish bool   `json:"canPublish"`
}

func New(store *community.Store, auth *identity.AuthClient, endpoint, key, secret, origin string) (*Service, error) {
	target, err := url.Parse(endpoint)
	if err != nil || target.Host == "" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || target.Path != "" || (target.Scheme != "http" && target.Scheme != "https") || key == "" || len(secret) < 32 {
		return nil, errors.New("invalid media configuration")
	}
	return &Service{store: store, auth: auth, key: key, secret: secret, origin: origin, target: target, room: lksdk.NewRoomServiceClient(endpoint, key, secret), connections: map[string]map[*trackedBody]struct{}{}}, nil
}
func (s *Service) Grant(ctx context.Context, actor community.Participant, channel, subject, sessionID, resumeIdentity string) (Grant, error) {
	m, err := s.store.StartVoice(ctx, actor, channel, subject, sessionID, resumeIdentity, identity.ClientAddress(ctx), s.remove)
	if err != nil {
		return Grant{}, err
	}
	grant := &lkauth.VideoGrant{RoomJoin: true, Room: m.ChannelID, CanPublish: new(!m.MicMuted), CanSubscribe: new(true), CanPublishData: new(false), CanUpdateOwnMetadata: new(false)}
	if !m.MicMuted {
		grant.SetCanPublishSources([]livekit.TrackSource{livekit.TrackSource_MICROPHONE})
	}
	token, err := lkauth.NewAccessToken(s.key, s.secret).SetIdentity(m.Identity).SetName(m.Nickname).SetVideoGrant(grant).SetValidFor(60 * time.Second).ToJWT()
	if err != nil {
		return Grant{}, err
	}
	return Grant{URL: strings.Replace(s.origin, "http", "ws", 1) + "/livekit", Token: token, Identity: m.Identity, ChannelID: m.ChannelID, CanPublish: !m.MicMuted}, nil
}
func (s *Service) Revoke(ctx context.Context, participantID string) error {
	m, err := s.store.RevokeVoice(ctx, participantID)
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

// FinishRevocations removes the exact grants invalidated by a community transaction.
func (s *Service) FinishRevocations(ctx context.Context, sessions []community.MediaSession) {
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	for _, session := range sessions {
		if bounded.Err() != nil {
			return
		}
		if s.remove(bounded, session) == nil {
			_ = s.store.ForgetVoice(bounded, session.Identity)
		}
	}
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
	if err != nil && !errors.Is(err, community.ErrVoiceResumePending) {
		return m, err
	}
	if m.AuthSessionID != "" {
		if authErr := s.auth.CheckSessionActive(ctx, identity.Account{RegisteredClaims: jwt.RegisteredClaims{Subject: m.AuthSubject}, SessionID: m.AuthSessionID}); authErr != nil {
			return m, authErr
		}
	}
	return m, err
}

// Native SDKs send their media grant as a bearer credential. Browser signaling
// carries the grant in the URL and must still present the exact application origin.
func signalingGrant(r *http.Request, origin string) (token string, bearer bool) {
	origins := r.Header.Values("Origin")
	if len(origins) > 1 || len(origins) == 1 && origins[0] != origin {
		return "", false
	}
	query := r.URL.Query()["access_token"]
	headers := r.Header.Values("Authorization")
	if len(headers) == 1 && len(query) == 0 {
		if value, ok := strings.CutPrefix(headers[0], "Bearer "); ok && !strings.ContainsAny(value, " ,\t") {
			return value, true
		}
	}
	if len(headers) == 0 && len(origins) == 1 && len(query) == 1 {
		return query[0], false
	}
	return "", false
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "access denied", http.StatusForbidden)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/livekit")
	switch path {
	case "/rtc", "/rtc/validate", "/rtc/v1", "/rtc/v1/validate":
	default:
		http.NotFound(w, r)
		return
	}
	raw, bearer := signalingGrant(r, s.origin)
	if len(raw) == 0 || len(raw) > 8192 {
		http.Error(w, "access denied", http.StatusForbidden)
		return
	}
	var claims struct {
		jwt.RegisteredClaims
		Video *lkauth.VideoGrant `json:"video"`
	}
	token, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return []byte(s.secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(s.key), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Video == nil || !claims.Video.RoomJoin {
		http.Error(w, "access denied", http.StatusForbidden)
		return
	}
	m, err := s.current(r.Context(), claims.Subject)
	if err == nil && m.AuthSubject == "" {
		err = s.store.CheckGuestAddress(r.Context(), identity.ClientAddress(r.Context()))
	}
	if err != nil || m.ChannelID != claims.Video.Room {
		http.Error(w, "access denied", http.StatusForbidden)
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(s.target)
			p.Out.URL.Path = path
			p.Out.URL.RawPath = ""
			p.Out.Header.Del("Cookie")
			p.Out.Header.Del("Authorization")
			if bearer {
				p.Out.Header.Set("Authorization", "Bearer "+raw)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "media unavailable", http.StatusBadGateway)
		},
		ModifyResponse: func(response *http.Response) error {
			if response.StatusCode != http.StatusSwitchingProtocols {
				return nil
			}
			body, ok := response.Body.(io.ReadWriteCloser)
			if !ok {
				return errors.New("invalid media upgrade")
			}
			// Register before rechecking: a concurrent revocation either closes
			// this tracked connection or is observed by the recheck.
			tracked, err := s.trackConnection(m.Identity, body)
			if err != nil {
				return err
			}
			response.Body = tracked
			if _, err := s.current(r.Context(), m.Identity); err != nil {
				return errors.New("media membership revoked")
			}
			if m.AuthSubject == "" {
				if err := s.store.RecordVoiceAddress(r.Context(), m.Identity, identity.ClientAddress(r.Context())); err != nil {
					return err
				}
			}
			s.mu.Lock()
			_, trackedDuringCheck := s.connections[m.Identity][tracked]
			s.mu.Unlock()
			if !trackedDuringCheck {
				return net.ErrClosed
			}
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
		if errors.Is(err, community.ErrVoiceResumePending) ||
			(!errors.Is(err, community.ErrDenied) && !errors.Is(err, identity.ErrUnauthorized)) {
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
	s.connections = nil
	s.closed = true
	s.mu.Unlock()
	for _, set := range connections {
		for c := range set {
			_ = c.Close()
		}
	}
}

func (s *Service) Leave(ctx context.Context, participantID, mediaIdentity string) error {
	m, err := s.store.RevokeOwnedVoice(ctx, participantID, mediaIdentity)
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
