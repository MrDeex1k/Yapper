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
func TestInviteConcurrencyIdentityAndBan(t *testing.T) {
	s, owner := configuredStore(t)
	token, err := s.Invite(t.Context(), owner.ID)
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
	if _, err = s.Invite(t.Context(), winner.ID); !errors.Is(err, ErrDenied) {
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
