package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestEventDeliveryRequiresAnOpenStreamAndChatEvents(t *testing.T) {
	clients := []*client{{}}
	stream := &eventStream{stopped: make(chan struct{})}
	streams := []*eventStream{stream}
	var before [onlineClients]int64
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := awaitEvents(ctx, clients, streams, before); err == nil || !strings.Contains(err.Error(), "missed chat events") {
		t.Fatalf("an open stream without chat events passed: %v", err)
	}
	clients[0].events.Add(batchSize)
	if err := awaitEvents(t.Context(), clients, streams, before); err != nil {
		t.Fatalf("delivered chat events did not pass: %v", err)
	}
	close(stream.stopped)
	if err := awaitEvents(t.Context(), clients, streams, before); err == nil || !strings.Contains(err.Error(), "lost its event stream") {
		t.Fatalf("a closed stream passed: %v", err)
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
