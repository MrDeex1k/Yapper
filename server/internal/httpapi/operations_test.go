package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRequestLimitSeparatesKeysAndExpires(t *testing.T) {
	var limit requestLimit
	now := time.Unix(100, 0)
	for range 2 {
		if allowed, _ := limit.take("first", 2, now); !allowed {
			t.Fatal("requests below the limit must pass")
		}
	}
	if allowed, retry := limit.take("first", 2, now.Add(time.Second)); allowed || retry != 59 {
		t.Fatalf("expected limited request for 59 more seconds, allowed=%v retry=%d", allowed, retry)
	}
	if allowed, _ := limit.take("second", 2, now); !allowed {
		t.Fatal("one participant's limit must not affect another key")
	}
	if allowed, _ := limit.take("first", 2, now.Add(time.Minute)); !allowed {
		t.Fatal("allowance must renew after the window")
	}
}

func TestGuestAdmissionRateResponse(t *testing.T) {
	const origin = "http://127.0.0.1"
	api, err := NewCommunity(nil, nil, nil, CommunityConfig{
		Origin: origin, SetupToken: strings.Repeat("x", 32), SetupExpires: time.Now(),
		TrustIngress: true, GuestJoinsPerMinute: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := func(address string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/guests", strings.NewReader("{}"))
		req.Header.Set("Origin", origin)
		req.Header.Set("X-Yapper-Client-IP", address)
		req.Header.Set("Content-Type", "application/json")
		api.ServeHTTP(response, req)
		return response
	}
	if got := request("192.0.2.1").Code; got != http.StatusBadRequest {
		t.Fatalf("invalid join after rate admission status=%d", got)
	}
	rejected := request("192.0.2.1")
	if rejected.Code != http.StatusTooManyRequests || rejected.Header().Get("Retry-After") == "" ||
		!strings.Contains(rejected.Body.String(), `"code":"try_later"`) || rejected.Header().Get("X-Request-ID") == "" {
		t.Fatalf("invalid rate response: status=%d body=%s", rejected.Code, rejected.Body)
	}
	if got := request("192.0.2.2").Code; got != http.StatusBadRequest {
		t.Fatalf("a different trusted address was unexpectedly limited, status=%d", got)
	}
}
