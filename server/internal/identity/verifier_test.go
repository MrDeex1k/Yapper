package identity

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/lestrrat-go/jwx/v3/jwk"
)

func TestVerifierTrustAndCache(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := jwk.Import(public)
	if err != nil {
		t.Fatal(err)
	}
	if err := key.Set("kid", "trusted"); err != nil {
		t.Fatal(err)
	}
	set := jwk.NewSet()
	if err := set.AddKey(key); err != nil {
		t.Fatal(err)
	}
	// JWX implements its JSON marshaler; retain its canonical JWK representation.
	data, err := json.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
	}))
	defer jwks.Close()
	verifier, err := NewVerifier("https://issuer.example", "yapper-api", jwks.URL)
	if err != nil {
		t.Fatal(err)
	}
	valid := jwt.RegisteredClaims{Subject: "owner-1", Issuer: "https://issuer.example", Audience: jwt.ClaimStrings{"yapper-api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}
	cases := []struct {
		name   string
		claims jwt.RegisteredClaims
		kid    string
		valid  bool
	}{
		{"valid", valid, "trusted", true},
		{"wrong issuer", jwt.RegisteredClaims{Subject: "owner-1", Issuer: "https://attacker.example", Audience: valid.Audience, ExpiresAt: valid.ExpiresAt}, "trusted", false},
		{"wrong audience", jwt.RegisteredClaims{Subject: "owner-1", Issuer: valid.Issuer, Audience: jwt.ClaimStrings{"another-api"}, ExpiresAt: valid.ExpiresAt}, "trusted", false},
		{"expired", jwt.RegisteredClaims{Subject: "owner-1", Issuer: valid.Issuer, Audience: valid.Audience, ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}, "trusted", false},
		{"missing expiry", jwt.RegisteredClaims{Subject: "owner-1", Issuer: valid.Issuer, Audience: valid.Audience}, "trusted", false},
		{"empty subject", jwt.RegisteredClaims{Issuer: valid.Issuer, Audience: valid.Audience, ExpiresAt: valid.ExpiresAt}, "trusted", false},
		{"unknown key", valid, "attacker", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, tc.claims)
			token.Header["kid"] = tc.kid
			token.Header["jku"] = "https://attacker.example/keys"
			encoded, err := token.SignedString(private)
			if err != nil {
				t.Fatal(err)
			}
			subject, err := verifier.Verify(t.Context(), encoded)
			if tc.valid {
				if err != nil || subject != "owner-1" {
					t.Fatalf("valid identity rejected: %v", err)
				}
			} else if err == nil {
				t.Fatal("invalid identity accepted")
			}
		})
	}
	if calls.Load() != 1 {
		t.Fatalf("unbounded key refresh: %d calls", calls.Load())
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, valid)
	token.Header["kid"] = "trusted"
	encoded, err := token.SignedString([]byte("attacker-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(t.Context(), encoded); err == nil {
		t.Fatal("algorithm confusion accepted")
	}
}

func TestVerifierRejectsJWKSRedirect(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.com", http.StatusFound)
	}))
	defer endpoint.Close()
	v, err := NewVerifier("https://issuer.example", "yapper-api", endpoint.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.key(t.Context(), "key"); err == nil {
		t.Fatal("redirect accepted")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRefreshDoesNotBlockCachedKeys(t *testing.T) {
	for _, malformed := range []bool{false, true} {
		name := "successful rotation"
		if malformed {
			name = "malformed refresh"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				public, _, err := ed25519.GenerateKey(rand.Reader)
				if err != nil {
					t.Fatal(err)
				}
				set := jwk.NewSet()
				for _, kid := range []string{"trusted", "rotated"} {
					key, err := jwk.Import(public)
					if err != nil {
						t.Fatal(err)
					}
					if err := key.Set("kid", kid); err != nil {
						t.Fatal(err)
					}
					if err := set.AddKey(key); err != nil {
						t.Fatal(err)
					}
				}
				data, err := json.Marshal(set)
				if err != nil {
					t.Fatal(err)
				}
				v, err := NewVerifier("https://issuer.example", "yapper-api", "https://issuer.example/jwks")
				if err != nil {
					t.Fatal(err)
				}
				trusted, _ := set.LookupKeyID("trusted")
				v.keys = jwk.NewSet()
				if err := v.keys.AddKey(trusted); err != nil {
					t.Fatal(err)
				}
				v.expires = time.Now().Add(time.Minute)
				originalExpiry := v.expires
				entered, release := make(chan struct{}), make(chan struct{})
				var calls atomic.Int32
				v.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
					calls.Add(1)
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
						return nil, r.Context().Err()
					}
					body := string(data)
					if malformed {
						body = "invalid JSON"
					}
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
				})
				results := make(chan error, 9)
				var workers sync.WaitGroup
				workers.Go(func() { _, err := v.key(t.Context(), "rotated"); results <- err })
				<-entered
				for range 8 {
					workers.Go(func() { _, err := v.key(t.Context(), "rotated"); results <- err })
				}
				synctest.Wait()
				// This must complete while the refresh HTTP response is still blocked.
				if _, err := v.key(t.Context(), "trusted"); err != nil {
					t.Fatalf("cached key blocked or rejected: %v", err)
				}
				ctx, cancel := context.WithCancel(t.Context())
				cancel()
				if _, err := v.key(ctx, "rotated"); err == nil {
					t.Fatal("canceled waiter accepted")
				}
				if calls.Load() != 1 {
					t.Fatalf("parallel refresh requests: %d", calls.Load())
				}
				close(release)
				workers.Wait()
				close(results)
				for err := range results {
					if (err != nil) != malformed {
						t.Fatalf("unexpected refresh result: %v", err)
					}
				}
				if malformed && !v.expires.Equal(originalExpiry) {
					t.Fatal("failed refresh changed cache expiry")
				}
				if _, err := v.key(t.Context(), "trusted"); err != nil {
					t.Fatal("refresh discarded trusted cached key")
				}
				if _, err := v.key(t.Context(), "unknown"); err == nil {
					t.Fatal("unknown key accepted")
				}
				if calls.Load() != 1 {
					t.Fatal("five-second refresh limit bypassed")
				}
			})
		})
	}
}
