package identity

import (
	"os"
	"testing"
)

func TestExternalAuth(t *testing.T) {
	path := os.Getenv("AUTH_TEST_TOKEN_FILE")
	if path == "" {
		t.Skip("run pnpm test:integration with a dedicated development database")
	}
	token, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewVerifier(os.Getenv("AUTH_TEST_ISSUER"), "yapper-api", os.Getenv("AUTH_TEST_JWKS"))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := verifier.Verify(t.Context(), string(token))
	if err != nil || subject != os.Getenv("AUTH_TEST_SUBJECT") {
		t.Fatalf("AUTH interoperability failed: %v", err)
	}
}
