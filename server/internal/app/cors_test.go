package app

import (
	"net/http/httptest"
	"testing"
)

func TestDesktopOriginIsExact(t *testing.T) {
	for _, origin := range []string{"yapper://app", "https://evil.example", "yapper://app.evil"} {
		r := httptest.NewRequest("OPTIONS", "/api/v1/channels", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		NewServer().Handler().ServeHTTP(w, r)
		if got := w.Header().Get("Access-Control-Allow-Origin"); (got != "") != (origin == "yapper://app") {
			t.Fatalf("origin %q allowed as %q", origin, got)
		}
	}
}
