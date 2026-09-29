package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthAndIdentityBoundary(t *testing.T) {
	handler := New(nil)
	for _, tc := range []struct {
		path   string
		status int
	}{{"/api/v1/health", http.StatusOK}, {"/api/v1/identity", http.StatusUnauthorized}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if response.Code != tc.status {
			t.Fatalf("%s: got %d", tc.path, response.Code)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("identity responses must not be cached")
		}
	}
}
