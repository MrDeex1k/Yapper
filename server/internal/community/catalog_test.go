package community

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"uuid"
)

func TestCatalogPreservesHistoryAndRevokesArchivedVoice(t *testing.T) {
	s, owner := configuredStore(t)
	ctx := t.Context()
	before, err := s.Catalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var text, voice Channel
	for _, ch := range before.Channels {
		switch ch.Kind {
		case "text":
			text = ch
		case "voice":
			voice = ch
		}
	}
	message, _, err := s.Send(ctx, owner.ID, text.ID, uuid.New().String(), "before migration")
	if err != nil {
		t.Fatal(err)
	}
	// Put the populated channels into their previous schema shape before reapplying.
	if _, err := s.Pool.Exec(ctx, "ALTER TABLE channels DROP COLUMN category_id, DROP COLUMN archived; DROP TABLE categories"); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := s.Catalog(ctx)
	if err != nil || len(after.Categories) != 0 || len(after.Channels) != 2 || after.Channels[0] != before.Channels[0] || after.Channels[1] != before.Channels[1] {
		t.Fatalf("catalog after migration: %+v, %v", after, err)
	}
	if err := s.SetOpenAdmission(ctx, owner.ID, true); err != nil {
		t.Fatal(err)
	}
	guest, _, err := s.Guest(ctx, "friend", "", netip.Addr{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveChannel(ctx, guest.ID, "", "denied", "text", ""); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest create: %v", err)
	}
	for _, name := range []string{"Social", "Games", "Work"} {
		if err := s.SaveCategory(ctx, owner.ID, "", name); err != nil {
			t.Fatal(err)
		}
	}
	after, err = s.Catalog(ctx)
	if err != nil || len(after.Categories) != 3 {
		t.Fatalf("categories: %+v, %v", after.Categories, err)
	}
	category := after.Categories[2].ID
	if err := s.MoveCategory(ctx, owner.ID, category, -1); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCategory(ctx, owner.ID, category, "Projects"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveChannel(ctx, owner.ID, text.ID, "updates", "", category); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveChannel(ctx, owner.ID, "", "lobby", "text", category); err != nil {
		t.Fatal(err)
	}
	if err := s.MoveChannel(ctx, owner.ID, text.ID, 1); err != nil {
		t.Fatal(err)
	}
	after, err = s.Catalog(ctx)
	if err != nil || len(after.Channels) != 3 || after.Categories[1].Name != "Projects" {
		t.Fatalf("updated catalog: %+v, %v", after, err)
	}
	var categorized []Channel
	for _, ch := range after.Channels {
		if ch.CategoryID == category {
			categorized = append(categorized, ch)
		}
	}
	if len(categorized) != 2 || categorized[0].Name != "lobby" || categorized[1].ID != text.ID || categorized[1].Name != "updates" {
		t.Fatalf("moved channels: %+v", categorized)
	}
	removal := func(context.Context, MediaSession) error { return nil }
	session, err := s.StartVoice(ctx, guest, voice.ID, "", "", netip.Addr{}, removal)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range []Channel{text, voice} {
		if err := s.ArchiveChannel(ctx, owner.ID, channel.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.VoiceSession(ctx, session.Identity); !errors.Is(err, ErrDenied) {
		t.Fatalf("archived session: %v", err)
	}
	if _, err := s.StartVoice(ctx, guest, voice.ID, "", "", netip.Addr{}, removal); !errors.Is(err, ErrDenied) {
		t.Fatalf("archived grant: %v", err)
	}
	if _, _, err := s.Send(ctx, owner.ID, text.ID, uuid.New().String(), "denied"); !errors.Is(err, ErrDenied) {
		t.Fatalf("archived send: %v", err)
	}
	history, err := s.History(ctx, text.ID, 0)
	if err != nil || len(history) != 1 || history[0].ID != message.ID {
		t.Fatalf("archived history: %+v, %v", history, err)
	}
}
