package community

import (
	"context"
	"errors"
	"net/netip"
	"slices"
	"testing"
	"uuid"
)

func TestMessageLifecycle(t *testing.T) {
	s, owner := configuredStore(t)
	ctx := t.Context()
	channels, err := s.Channels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[slices.IndexFunc(channels, func(c Channel) bool { return c.Kind == "text" })].ID
	if err := s.SetOpenAdmission(ctx, owner.ID, true); err != nil {
		t.Fatal(err)
	}
	author, _, err := s.Guest(ctx, "author", "", netip.Addr{})
	if err != nil {
		t.Fatal(err)
	}
	guest, _, err := s.Guest(ctx, "guest", "", netip.Addr{})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ProvisionModerator(ctx, owner.ID, "moderator", func(context.Context) (string, error) {
		return "moderator-message-test", nil
	}); err != nil {
		t.Fatal(err)
	}
	mod, err := s.AccountIdentity(ctx, "moderator-message-test")
	if err != nil {
		t.Fatal(err)
	}
	legacyID, requestID := uuid.New().String(), uuid.New().String()
	// Upgrade a populated Stage 2 table with all existing message identifiers.
	if _, err := s.Pool.Exec(ctx, `ALTER TABLE messages DROP COLUMN original_body_hash,DROP COLUMN edited_at,DROP COLUMN revision;
		ALTER TABLE messages ALTER COLUMN body SET NOT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, "INSERT INTO messages(id,channel_id,author_id,request_id,body) VALUES($1,$2,$3,$4,'original')",
		legacyID, channel, author.ID, requestID); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	initial, err := s.HistoryPage(ctx, channel, 0)
	if err != nil || len(initial.Messages) != 1 || initial.Revision != 0 || initial.Messages[0].ID != legacyID {
		t.Fatalf("legacy page: %+v, %v", initial, err)
	}
	if _, err := s.EditMessage(ctx, mod.ID, channel, legacyID, "moderator edit", 0); !errors.Is(err, ErrDenied) {
		t.Fatalf("moderator edit: %v", err)
	}
	if _, err := s.DeleteMessage(ctx, guest.ID, channel, legacyID); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest deletion: %v", err)
	}
	if changed, err := s.EditMessage(ctx, author.ID, channel, legacyID, "edited", 0); err != nil || !changed {
		t.Fatalf("author edit=%v: %v", changed, err)
	}
	if _, err := s.EditMessage(ctx, author.ID, channel, legacyID, "stale edit", 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale edit: %v", err)
	}
	current, fresh, err := s.Send(ctx, author.ID, channel, requestID, "original")
	if err != nil || fresh || current.ID != legacyID || current.Body != "edited" || current.EditedAt == nil {
		t.Fatalf("retry original send after edit: %+v %v %v", current, fresh, err)
	}
	if _, _, err := s.Send(ctx, author.ID, channel, requestID, "edited"); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed delivery retry accepted: %v", err)
	}
	delta, err := s.MessageChanges(ctx, channel, initial.Revision)
	if err != nil || len(delta) != 1 || delta[0].Message == nil || delta[0].Message.Body != "edited" {
		t.Fatalf("edit reconciliation: %+v, %v", delta, err)
	}
	if changed, err := s.DeleteMessage(ctx, mod.ID, channel, legacyID); err != nil || !changed {
		t.Fatalf("moderator deletion: %v %v", changed, err)
	}
	if changed, err := s.DeleteMessage(ctx, mod.ID, channel, legacyID); err != nil || changed {
		t.Fatalf("deletion retry: %v %v", changed, err)
	}
	if _, _, err := s.Send(ctx, author.ID, channel, requestID, "original"); !errors.Is(err, ErrMessageGone) {
		t.Fatalf("deleted send was resurrected: %v", err)
	}
	delta, err = s.MessageChanges(ctx, channel, current.Revision)
	if err != nil || len(delta) != 1 || delta[0].ID != legacyID || delta[0].Message != nil {
		t.Fatalf("deletion reconciliation: %+v, %v", delta, err)
	}
	var redacted bool
	if err := s.Pool.QueryRow(ctx, "SELECT body IS NULL AND original_body_hash IS NULL AND edited_at IS NULL FROM messages WHERE id=$1", legacyID).Scan(&redacted); err != nil || !redacted {
		t.Fatalf("body or edit metadata survived erasure: %v %v", redacted, err)
	}
	audit, err := s.Audit(ctx, mod.ID)
	if err != nil || len(audit) != 2 || audit[0].Action != "delete_message" || audit[0].MessageID == nil || *audit[0].MessageID != legacyID {
		t.Fatalf("deletion audit: %+v %v", audit, err)
	}

	for range pageSize + 7 {
		if _, _, err := s.Send(ctx, author.ID, channel, uuid.New().String(), "history"); err != nil {
			t.Fatal(err)
		}
	}
	newest, err := s.HistoryPage(ctx, channel, 0)
	if err != nil || len(newest.Messages) != pageSize || newest.Before == 0 {
		t.Fatalf("initial history page: %d %d %v", len(newest.Messages), newest.Before, err)
	}
	if _, _, err := s.Send(ctx, author.ID, channel, uuid.New().String(), "new arrival"); err != nil {
		t.Fatal(err)
	}
	older, err := s.HistoryPage(ctx, channel, newest.Before)
	if err != nil || len(older.Messages) != 7 || older.Before != 0 || older.Messages[6].Sequence >= newest.Before {
		t.Fatalf("older page while send committed: %+v %v", older, err)
	}
	changes, err := s.MessageChanges(ctx, channel, newest.Revision)
	if err != nil || len(changes) != 1 || changes[0].Message == nil || changes[0].Message.Body != "new arrival" {
		t.Fatalf("new arrival reconciliation: %+v %v", changes, err)
	}

	if _, err := s.Pool.Exec(ctx, "UPDATE messages SET created_at=now()-interval '2 days' WHERE id=$1", older.Messages[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveChannel(ctx, owner.ID, channel); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EditMessage(ctx, author.ID, channel, older.Messages[0].ID, "archive edit", older.Messages[0].Revision); !errors.Is(err, ErrDenied) {
		t.Fatalf("archive edit: %v", err)
	}
	if expired, err := s.ExpireMessages(ctx); err != nil || expired != "" {
		t.Fatalf("default retention erased history: %s %v", expired, err)
	}
	if err := s.SetMessageRetention(ctx, mod.ID, 1); !errors.Is(err, ErrDenied) {
		t.Fatalf("moderator changed installation retention: %v", err)
	}
	if err := s.SetMessageRetention(ctx, owner.ID, 1); err != nil {
		t.Fatal(err)
	}
	if expired, err := s.ExpireMessages(ctx); err != nil || expired != channel {
		t.Fatalf("retained archive cleanup: %s %v", expired, err)
	}
	history, err := s.History(ctx, channel, 0)
	if err != nil || len(history) != pageSize+7 || history[0].ID == older.Messages[0].ID {
		t.Fatalf("history after retention: %d %v", len(history), err)
	}
}
