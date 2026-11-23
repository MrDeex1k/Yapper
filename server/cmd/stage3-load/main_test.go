package main

import (
	"context"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestInvalidToneLeavesInstallationUntouched(t *testing.T) {
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	t.Setenv("STAGE3_SETUP_TOKEN", "test-installation")
	dir := t.TempDir()
	corrupt := filepath.Join(dir, "corrupt.ogg")
	if err := os.WriteFile(corrupt, []byte("not Ogg Opus"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(dir, "missing.ogg"), corrupt} {
		err := run(t.Context(), server.URL, path, 0, 10*time.Second)
		if err == nil || !strings.Contains(err.Error(), "validate test tone") {
			t.Fatalf("invalid fixture %s got %v", filepath.Base(path), err)
		}
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("invalid fixtures triggered %d HTTP requests", got)
	}
}

func TestEventDeliveryMatchesAcknowledgedIDsOnAllStreams(t *testing.T) {
	requests := [batchSize]string{"request-a", "request-b", "request-c"}
	acknowledged := [batchSize]message{
		{"a", requests[0]}, {"b", requests[1]}, {"c", requests[2]},
	}
	complete := &eventStream{stopped: make(chan struct{})}
	incomplete := &eventStream{stopped: make(chan struct{})}
	streams := []*eventStream{complete, incomplete}
	for _, stream := range streams {
		stream.expectBatch(requests)
	}
	for _, entry := range acknowledged {
		complete.recordMessage(entry)
	}
	incomplete.recordMessage(acknowledged[0])
	incomplete.recordMessage(acknowledged[0])
	incomplete.recordMessage(acknowledged[1])
	incomplete.recordMessage(message{"unrelated", "other-request"})

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := awaitEvents(ctx, streams, acknowledged); err == nil || !strings.Contains(err.Error(), "1 participants missed chat events") {
		t.Fatalf("a stream missing c passed using duplicated or unrelated messages: %v", err)
	}
	incomplete.recordMessage(acknowledged[2])
	if err := awaitEvents(t.Context(), streams, acknowledged); err != nil {
		t.Fatalf("events received before HTTP acknowledgement did not pass: %v", err)
	}
	close(incomplete.stopped)
	if err := awaitEvents(t.Context(), streams, acknowledged); err == nil || !strings.Contains(err.Error(), "lost its event stream") {
		t.Fatalf("a closed stream passed: %v", err)
	}
}

func TestReplacementRequiresFreshRTPInBothDirections(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		bridge := new(voiceBridge)
		for i := range voiceRoomSize {
			bridge.sessions[i] = &voiceClient{
				identity: string(rune('a' + i)),
				incoming: make(map[string]*atomic.Uint64),
			}
		}
		replacement := bridge.sessions[0]
		for i, peer := range bridge.sessions[1:voiceRoomSize] {
			replacement.counter(peer.identity).Add(1)
			peer.counter("previous-identity").Add(1)
			if i != 0 {
				peer.counter(replacement.identity).Add(1)
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), voiceDeadline)
		defer cancel()
		if err := bridge.awaitReplacementRTP(ctx, 0); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("prior session packets counted as replacement audio: %v", err)
		}
		bridge.sessions[1].counter(replacement.identity).Add(1)
		if err := bridge.awaitReplacementRTP(t.Context(), 0); err != nil {
			t.Fatalf("fresh RTP in both directions failed: %v", err)
		}
	})
}

func TestConnectCleansUpGrantAfterFailedResponse(t *testing.T) {
	for _, test := range []struct {
		name, response, leaveIdentity string
	}{
		{"lost response", `{"`, ""},
		{"truncated grant", `{"identity":"replacement","token":`, ""},
		{"stale identity", `{"identity":"previous"}`, ""},
		{"identified grant", `{"identity":"replacement"}`, "replacement"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var issued, active atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				cookie, err := r.Cookie("guest")
				if err != nil || cookie.Value != "test-guest" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/api/v1/voice/grant":
					issued.Store(true)
					active.Store(true)
					w.WriteHeader(http.StatusCreated)
					_, _ = w.Write([]byte(test.response))
				case "/api/v1/voice/leave":
					var body struct {
						Identity string `json:"identity"`
					}
					if err := json.UnmarshalRead(r.Body, &body); err != nil || body.Identity != test.leaveIdentity {
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					active.Store(false)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			guest := newClient(server.URL)
			address, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			guest.http.Jar.SetCookies(address, []*http.Cookie{{Name: "guest", Value: "test-guest"}})
			bridge := new(voiceBridge)
			if err := bridge.connect(t.Context(), 0, guest, "voice", "fixture.ogg", "previous"); err == nil {
				t.Fatal("invalid grant response passed")
			}
			if !issued.Load() || active.Load() {
				t.Fatal("failed connection left an active replacement grant")
			}
		})
	}
}

func TestThresholdsExcludeWarmupRTP(t *testing.T) {
	warmup := rtpMetrics{packets: 60_000, samples: 60_000}
	for _, test := range []struct {
		name string
		end  rtpMetrics
	}{
		{"gaps", rtpMetrics{packets: 70_000, gaps: 200, samples: 70_000}},
		{"variation", rtpMetrics{packets: 70_000, jitterMicros: 300_000_000, samples: 70_000}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.end.validate(); err != nil {
				t.Fatalf("setup did not dilute the failed measurement: %v", err)
			}
			if err := test.end.since(warmup).validate(); err == nil {
				t.Fatal("sustained RTP above the threshold passed")
			}
		})
	}
}

func TestRTPSequenceKeepsForwardPositionAcrossReorderingAndWrap(t *testing.T) {
	start := time.Now()
	for _, test := range []struct {
		name      string
		sequences []uint16
	}{
		{"late packet", []uint16{100, 102, 101, 103, 103}},
		{"wraparound", []uint16{65534, 0, 65535, 1, 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var last rtpArrival
			var gaps, samples int
			for i, sequence := range test.sequences {
				skipped, _, sampled := last.observe(rtpArrival{sequence, uint32(i * 960), start.Add(time.Duration(i) * 20 * time.Millisecond)})
				gaps += int(skipped)
				if sampled {
					samples++
				}
			}
			if gaps != 1 || samples != 2 {
				t.Fatalf("got %d forward gaps across %d samples, want 1 across 2", gaps, samples)
			}
		})
	}
}
