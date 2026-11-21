// Package community owns persistent community identities and conversation state.
package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"net/netip"
	"time"
	"uuid"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrMessageGone   = errors.New("message unavailable")
	ErrDenied        = errors.New("access denied")
	ErrConflict      = errors.New("conflict")
	ErrNotConfigured = errors.New("not configured")
)

//go:embed schema.sql
var schema string

type Store struct{ Pool *pgxpool.Pool }
type Participant struct {
	ID             string `json:"id"`
	Nickname       string `json:"nickname"`
	Role           string `json:"role"`
	MicMuted       bool   `json:"micMuted"`
	KickGeneration int64  `json:"-"`
}
type Channel struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	CategoryID string `json:"categoryId"`
	Archived   bool   `json:"archived"`
}
type Message struct {
	ID        string     `json:"id"`
	Sequence  int64      `json:"sequence"`
	ChannelID string     `json:"channelId"`
	AuthorID  string     `json:"authorId"`
	Nickname  string     `json:"nickname"`
	RequestID string     `json:"requestId"`
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"createdAt"`
	EditedAt  *time.Time `json:"editedAt,omitempty"`
	Revision  int64      `json:"revision"`
}
type State struct {
	Name          string `json:"name"`
	Configured    bool   `json:"configured"`
	OpenAdmission bool   `json:"openAdmission"`
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(743212)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, schema); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) State(ctx context.Context) (State, error) {
	var state State
	err := s.Pool.QueryRow(ctx, "SELECT name,configured,open_admission FROM installation WHERE singleton").Scan(&state.Name, &state.Configured, &state.OpenAdmission)
	return state, err
}

// Setup serializes owner binding; provision must be idempotent at the AUTH service.
func (s *Store) Setup(ctx context.Context, name, nickname string, provision func(context.Context) (string, error)) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var configured bool
	if err = tx.QueryRow(ctx, "SELECT configured FROM installation WHERE singleton FOR UPDATE").Scan(&configured); err != nil {
		return err
	}
	if configured {
		return ErrConflict
	}
	subject, err := provision(ctx)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO participants(id,nickname,role,auth_subject) VALUES($1,$2,'owner',$3)", uuid.New().String(), nickname, subject); err != nil {
		return err
	}
	for _, c := range []struct{ name, kind string }{{"general", "text"}, {"Lounge", "voice"}} {
		if _, err = tx.Exec(ctx, "INSERT INTO channels(id,name,kind) VALUES($1,$2,$3)", uuid.New().String(), c.name, c.kind); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE installation SET configured=true,name=$1 WHERE singleton", name); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func newSecret() string        { var b [32]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func digest(raw string) []byte { d := sha256.Sum256([]byte(raw)); return d[:] }
func (s *Store) Guest(ctx context.Context, nickname, invite string, address netip.Addr) (Participant, string, error) {
	observedAt := time.Now()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Participant{}, "", err
	}
	defer tx.Rollback(ctx)
	if err := lockGuestAddresses(ctx, tx, false); err != nil {
		return Participant{}, "", err
	}
	var configured, open bool
	if err = tx.QueryRow(ctx, "SELECT configured,open_admission FROM installation WHERE singleton FOR SHARE").Scan(&configured, &open); err != nil {
		return Participant{}, "", err
	}
	if !configured {
		return Participant{}, "", ErrNotConfigured
	}
	if err := checkGuestAddress(ctx, tx, address); err != nil {
		return Participant{}, "", err
	}
	if !open {
		tag, e := tx.Exec(ctx, `UPDATE invitations SET remaining=remaining-1
			WHERE token_hash=$1 AND (remaining IS NULL OR remaining>0)
			  AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND NOT revoked`, digest(invite))
		if e != nil {
			return Participant{}, "", e
		}
		if tag.RowsAffected() != 1 {
			return Participant{}, "", ErrDenied
		}
	}
	p := Participant{ID: uuid.New().String(), Nickname: nickname, Role: "participant"}
	secret := newSecret()
	if _, err = tx.Exec(ctx, "INSERT INTO participants(id,nickname,role,credential_hash,last_ip,last_ip_observed_at) VALUES($1,$2,$3,$4,$5,$6)", p.ID, p.Nickname, p.Role, digest(secret), address, observedAt); err != nil {
		return Participant{}, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return Participant{}, "", err
	}
	return p, secret, nil
}
func (s *Store) GuestIdentity(ctx context.Context, secret string, address netip.Addr) (Participant, error) {
	observedAt := time.Now()
	if len(secret) != 64 {
		return Participant{}, ErrDenied
	}
	if err := s.CheckGuestAddress(ctx, address); err != nil {
		return Participant{}, err
	}
	p, err := scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role,mic_muted,kick_generation,banned FROM participants WHERE credential_hash=$1", digest(secret)))
	if err != nil || !address.IsValid() {
		return p, err
	}
	return p, s.RecordGuestAddress(ctx, p, address, observedAt)
}

// RecordGuestAddress verifies a guest and preserves the newest address observation.
func (s *Store) RecordGuestAddress(ctx context.Context, guest Participant, address netip.Addr, observedAt time.Time) error {
	if !address.IsValid() {
		return nil
	}
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lockGuestAddresses(ctx, tx, false); err != nil {
			return err
		}
		if err := checkGuestAddress(ctx, tx, address); err != nil {
			return err
		}
		var banned bool
		var kickGeneration int64
		err := tx.QueryRow(ctx, "SELECT banned,kick_generation FROM participants WHERE id=$1 AND auth_subject IS NULL FOR UPDATE", guest.ID).Scan(&banned, &kickGeneration)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDenied
		}
		if err != nil {
			return err
		}
		if banned {
			return ErrBanned
		}
		if kickGeneration != guest.KickGeneration {
			return ErrConflict
		}
		_, err = tx.Exec(ctx, `UPDATE participants SET last_ip=$2,last_ip_observed_at=$3
			WHERE id=$1 AND (last_ip_observed_at IS NULL OR last_ip_observed_at<$3)`, guest.ID, address, observedAt)
		return err
	})
}
func (s *Store) AccountIdentity(ctx context.Context, subject string) (Participant, error) {
	return scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role,mic_muted,kick_generation,banned FROM participants WHERE auth_subject=$1", subject))
}
func (s *Store) Participant(ctx context.Context, id string) (Participant, error) {
	return scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role,mic_muted,kick_generation,banned FROM participants WHERE id=$1", id))
}
func scanParticipant(row pgx.Row) (Participant, error) {
	var p Participant
	var banned bool
	err := row.Scan(&p.ID, &p.Nickname, &p.Role, &p.MicMuted, &p.KickGeneration, &banned)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	} else if err == nil && banned {
		err = ErrBanned
	}
	return p, err
}
func owner(ctx context.Context, tx pgx.Tx, id string) error {
	var role string
	err := tx.QueryRow(ctx, "SELECT role FROM participants WHERE id=$1 AND NOT banned FOR SHARE", id).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && role != "owner" {
		return ErrDenied
	}
	return err
}
