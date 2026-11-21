package community

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"uuid"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	admin, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_" + uuid.New().String()
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(t.Context(), "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = identifier
	pool, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
	})
	store := &Store{Pool: pool}
	if err = store.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	return store
}
func configuredStore(t *testing.T) (*Store, Participant) {
	t.Helper()
	s := testStore(t)
	if err := s.Setup(t.Context(), "Test", "owner", func(context.Context) (string, error) { return "owner-subject", nil }); err != nil {
		t.Fatal(err)
	}
	p, err := s.AccountIdentity(t.Context(), "owner-subject")
	if err != nil {
		t.Fatal(err)
	}
	return s, p
}
func TestConcurrentSetupCreatesOneOwner(t *testing.T) {
	s := testStore(t)
	var calls, success atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			err := s.Setup(t.Context(), "Test", "owner", func(context.Context) (string, error) { calls.Add(1); return "owner-subject", nil })
			if err == nil {
				success.Add(1)
			} else if !errors.Is(err, ErrConflict) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 || success.Load() != 1 {
		t.Fatalf("provisions=%d success=%d", calls.Load(), success.Load())
	}
}

func TestAdmissionControls(t *testing.T) {
	s, owner := configuredStore(t)
	ctx := t.Context()
	if _, _, err := s.Guest(ctx, "uninvited", ""); !errors.Is(err, ErrDenied) {
		t.Fatalf("closed admission: %v", err)
	}
	if err := s.SetOpenAdmission(ctx, owner.ID, true); err != nil {
		t.Fatal(err)
	}
	guest, credential, err := s.Guest(ctx, "walk in", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetOpenAdmission(ctx, guest.ID, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest changed admission: %v", err)
	}
	if err := s.SetOpenAdmission(ctx, owner.ID, false); err != nil {
		t.Fatal(err)
	}
	if restored, err := s.GuestIdentity(ctx, credential); err != nil || restored.ID != guest.ID {
		t.Fatalf("closing admission removed membership: %v", err)
	}
	if _, _, err = s.Guest(ctx, "new guest", ""); !errors.Is(err, ErrDenied) {
		t.Fatalf("closed admission allowed new guest: %v", err)
	}

	token, err := s.Invite(ctx, owner.ID, InvitationOptions{MaxUses: 3})
	if err != nil {
		t.Fatal(err)
	}
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			if _, _, err := s.Guest(ctx, "friend", token); err == nil {
				wins.Add(1)
			} else if !errors.Is(err, ErrDenied) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if wins.Load() != 3 {
		t.Fatalf("admissions=%d, want 3", wins.Load())
	}
	token, err = s.Invite(ctx, owner.ID, InvitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, _, err := s.Guest(ctx, "invited", token); err != nil {
			t.Fatal("unlimited invitation failed", err)
		}
	}
	items, err := s.Invitations(ctx, owner.ID)
	if err != nil || len(items) != 2 {
		t.Fatalf("invitation list: %v, %v", items, err)
	}
	unlimited, exhausted := items[0], items[1]
	if unlimited.Remaining != nil || unlimited.ExpiresAt != nil ||
		exhausted.Remaining == nil || *exhausted.Remaining != 0 || exhausted.ExpiresAt != nil {
		t.Fatalf("unexpected invitation settings: %+v", items)
	}
	if _, err := s.Invitations(ctx, guest.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest listed invitations: %v", err)
	}
	if err := s.RevokeInvitation(ctx, guest.ID, unlimited.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest revoked invitation: %v", err)
	}
	for range 2 {
		if err := s.RevokeInvitation(ctx, owner.ID, unlimited.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.Guest(ctx, "late guest", token); !errors.Is(err, ErrDenied) {
		t.Fatalf("revoked invitation allowed admission: %v", err)
	}
}

func TestInvitationMigrationRetainsLegacyCodes(t *testing.T) {
	s, owner := configuredStore(t)
	ctx := t.Context()
	if _, err := s.Pool.Exec(ctx, `ALTER TABLE invitations ALTER COLUMN remaining SET NOT NULL,
		ALTER COLUMN expires_at SET NOT NULL, DROP COLUMN created_at`); err != nil {
		t.Fatal(err)
	}
	token := newSecret()
	if _, err := s.Pool.Exec(ctx, `INSERT INTO invitations(id,token_hash,remaining,expires_at)
		VALUES($1,$2,1,now()+interval '24 hours')`, uuid.New().String(), digest(token)); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	items, err := s.Invitations(ctx, owner.ID)
	if err != nil || len(items) != 1 || items[0].CreatedAt.IsZero() || items[0].ExpiresAt == nil {
		t.Fatalf("legacy invitation metadata: %v, %v", items, err)
	}
	if _, _, err := s.Guest(ctx, "legacy invite", token); err != nil {
		t.Fatal(err)
	}
	expired, err := s.Invite(ctx, owner.ID, InvitationOptions{ExpiresInHours: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE invitations SET expires_at=now() WHERE token_hash=$1", digest(expired)); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Guest(ctx, "expired invite", expired); !errors.Is(err, ErrDenied) {
		t.Fatalf("expired invitation allowed admission: %v", err)
	}
}
func TestInviteConcurrencyIdentityAndBan(t *testing.T) {
	s, owner := configuredStore(t)
	token, err := s.Invite(t.Context(), owner.ID, InvitationOptions{ExpiresInHours: 24, MaxUses: 1})
	if err != nil {
		t.Fatal(err)
	}
	var successes atomic.Int32
	var winner Participant
	var secret string
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			p, key, err := s.Guest(t.Context(), "friend", token)
			if err == nil {
				successes.Add(1)
				mu.Lock()
				winner = p
				secret = key
				mu.Unlock()
			} else if !errors.Is(err, ErrDenied) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("admissions=%d", successes.Load())
	}
	restored, err := s.GuestIdentity(t.Context(), secret)
	if err != nil || restored.ID != winner.ID {
		t.Fatal("identity not preserved", err)
	}
	if _, err = s.Invite(t.Context(), winner.ID, InvitationOptions{ExpiresInHours: 24, MaxUses: 1}); !errors.Is(err, ErrDenied) {
		t.Fatal("guest created invitation", err)
	}
	if err = s.Ban(t.Context(), winner.ID, owner.ID); !errors.Is(err, ErrDenied) {
		t.Fatal("guest banned owner", err)
	}
	if err = s.Ban(t.Context(), owner.ID, winner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GuestIdentity(t.Context(), secret); !errors.Is(err, ErrDenied) {
		t.Fatal("banned credential accepted", err)
	}
}
func TestMessageRetryAndHistory(t *testing.T) {
	s, owner := configuredStore(t)
	channels, err := s.Channels(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var channel string
	for _, c := range channels {
		if c.Kind == "text" {
			channel = c.ID
		}
	}
	request := uuid.New().String()
	var created atomic.Int32
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			_, fresh, err := s.Send(t.Context(), owner.ID, channel, request, "hello")
			if err != nil {
				t.Error(err)
			}
			if fresh {
				created.Add(1)
			}
		})
	}
	wg.Wait()
	if created.Load() != 1 {
		t.Fatalf("committed copies=%d", created.Load())
	}
	if _, _, err = s.Send(t.Context(), owner.ID, channel, request, "different"); !errors.Is(err, ErrConflict) {
		t.Fatal("request ID reused with different body", err)
	}
	history, err := s.History(t.Context(), channel, 0)
	if err != nil || len(history) != 1 || history[0].Body != "hello" {
		t.Fatal("incorrect history", history, err)
	}
	next, _, err := s.Send(t.Context(), owner.ID, channel, uuid.New().String(), "next")
	if err != nil {
		t.Fatal(err)
	}
	tail, err := s.History(t.Context(), channel, history[0].Sequence)
	if err != nil || len(tail) != 1 || tail[0].ID != next.ID {
		t.Fatal("cursor did not reconcile", tail, err)
	}
}

func TestVoiceReplacementCommitsBeforeRemovalAndPreservesRetry(t *testing.T) {
	s, owner := configuredStore(t)
	channels, err := s.Channels(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var channel string
	for _, c := range channels {
		if c.Kind == "voice" {
			channel = c.ID
		}
	}
	old, err := s.StartVoice(t.Context(), owner.ID, channel, "owner-subject", "session", func(context.Context, MediaSession) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	removalFailure := errors.New("LiveKit unavailable")
	_, err = s.StartVoice(t.Context(), owner.ID, channel, "owner-subject", "session", func(ctx context.Context, stale MediaSession) error {
		if stale.Identity != old.Identity {
			t.Fatal("wrong identity removed")
		}
		if _, err := s.VoiceSession(ctx, stale.Identity); !errors.Is(err, ErrDenied) {
			t.Fatal("old grant still accepted while removal is in progress")
		}
		return removalFailure
	})
	if !errors.Is(err, removalFailure) {
		t.Fatalf("removal failure not reported: %v", err)
	}
	pending, err := s.PendingVoiceRemovals(t.Context())
	if err != nil || len(pending) != 1 || pending[0].Identity != old.Identity {
		t.Fatalf("failed removal lost: %v %v", pending, err)
	}
	sessions, err := s.AllVoiceSessions(t.Context())
	if err != nil || len(sessions) != 1 || sessions[0].Identity == old.Identity {
		t.Fatal("replacement did not commit")
	}
	// A delayed leave and reconciliation snapshot may only revoke their exact epoch.
	if _, err := s.RevokeOwnedVoice(t.Context(), owner.ID, old.Identity); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("stale leave touched replacement")
	}
	if _, err := s.RevokeVoiceIdentity(t.Context(), old.Identity); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("stale reconciliation touched replacement")
	}
	if _, err := s.VoiceSession(t.Context(), sessions[0].Identity); err != nil {
		t.Fatal("replacement revoked by stale operation")
	}
	if err := s.ForgetVoiceRemoval(t.Context(), old.Identity); err != nil {
		t.Fatal(err)
	}
	pending, err = s.PendingVoiceRemovals(t.Context())
	if err != nil || len(pending) != 0 {
		t.Fatal("acknowledged removal not cleared")
	}
}
