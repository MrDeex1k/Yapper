package app

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
)

func TestHealthSeparatesDependencyAndLiveness(t *testing.T) {
	s := NewServer()
	s.CheckDependency = func(context.Context) error { return errors.New("offline") }
	for path, want := range map[string]int{"/health/live": 200, "/health/ready": 503, "/api/v1/info": 200} {
		r := httptest.NewRecorder()
		s.Handler().ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != want {
			t.Fatalf("%s: got %d want %d", path, r.Code, want)
		}
	}
	s.CheckDependency = nil
	s.Drain()
	r := httptest.NewRecorder()
	s.Handler().ServeHTTP(r, httptest.NewRequest("GET", "/health/ready", nil))
	if r.Code != 503 {
		t.Fatal("draining server accepted readiness")
	}
}
func TestConfigRejectsInvalidAddressAndTimeout(t *testing.T) {
	t.Setenv("HTTP_ADDR", "invalid")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted invalid address")
	}
	t.Setenv("HTTP_ADDR", "127.0.0.1:8080")
	t.Setenv("SHUTDOWN_TIMEOUT", "0s")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted zero shutdown timeout")
	}
}
