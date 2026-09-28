// Package identity verifies registered-account identity at the AUTH boundary.
package identity

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/lestrrat-go/jwx/v3/jwk"
)

var ErrUnauthorized = errors.New("invalid identity token")

// Verifier trusts exactly one configured issuer and JWKS URL. Roles are checked separately.
type Verifier struct {
	issuer      string
	audience    string
	endpoint    string
	client      *http.Client
	mu          sync.Mutex
	keys        jwk.Set
	expires     time.Time
	lastAttempt time.Time
}

func NewVerifier(issuer, audience, endpoint string) (*Verifier, error) {
	for _, raw := range []string{issuer, endpoint} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
			return nil, errors.New("invalid authentication URL")
		}
	}
	if audience == "" {
		return nil, errors.New("authentication audience is required")
	}
	return &Verifier{issuer: issuer, audience: audience, endpoint: endpoint, client: &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("JWKS redirects are disabled") },
	}}, nil
}

func (v *Verifier) Verify(ctx context.Context, raw string) (string, error) {
	if len(raw) == 0 || len(raw) > 8192 {
		return "", ErrUnauthorized
	}
	claims := new(jwt.RegisteredClaims)
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" || len(kid) > 128 {
			return nil, ErrUnauthorized
		}
		return v.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(5*time.Second))
	if err != nil || !token.Valid || claims.Subject == "" {
		return "", ErrUnauthorized
	}
	return claims.Subject, nil
}

func (v *Verifier) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	if v.keys != nil && now.Before(v.expires) {
		if key, ok := v.keys.LookupKeyID(kid); ok {
			return exportKey(key)
		}
	}
	// Bound refresh attempts even when attackers supply arbitrary unknown key IDs.
	if now.Sub(v.lastAttempt) < 5*time.Second {
		return nil, ErrUnauthorized
	}
	v.lastAttempt = now
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.endpoint, nil)
	if err != nil {
		return nil, ErrUnauthorized
	}
	response, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("JWKS unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrUnauthorized
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(data) > 65536 {
		return nil, ErrUnauthorized
	}
	keys, err := jwk.Parse(data)
	if err != nil || keys.Len() == 0 || keys.Len() > 16 {
		return nil, ErrUnauthorized
	}
	v.keys = keys
	v.expires = now.Add(5 * time.Minute)
	key, ok := keys.LookupKeyID(kid)
	if !ok {
		return nil, ErrUnauthorized
	}
	return exportKey(key)
}

func exportKey(key jwk.Key) (ed25519.PublicKey, error) {
	var raw ed25519.PublicKey
	if err := jwk.Export(key, &raw); err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, ErrUnauthorized
	}
	return raw, nil
}
