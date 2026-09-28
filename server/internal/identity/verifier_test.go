package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
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
