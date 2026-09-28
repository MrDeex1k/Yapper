package app

import (
	"context"
	"testing"
)

func TestSlowSubscriberIsDisconnected(t *testing.T) {
	h := newHub()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	c := &subscriber{userID: "u", channelID: "room", events: make(chan Event, 2), cancel: cancel}
	if !h.add(c) {
		t.Fatal("admission failed")
	}
	h.publish("other", "message.created")
	if len(c.events) != 0 {
		t.Fatal("cross-channel notification")
	}
	for range 3 {
		h.publish("room", "message.created")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("slow consumer was not disconnected")
	}
	h.remove(c)
}
func TestPerUserSubscriptionLimit(t *testing.T) {
	h := newHub()
	for range 8 {
		if !h.add(&subscriber{userID: "u"}) {
			t.Fatal("early rejection")
		}
	}
	if h.add(&subscriber{userID: "u"}) {
		t.Fatal("unbounded sessions")
	}
}
