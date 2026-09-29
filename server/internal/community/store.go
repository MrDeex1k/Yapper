// Package community owns persistent community identities and conversation state.
package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"time"
	"uuid"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrDenied        = errors.New("access denied")
	ErrConflict      = errors.New("conflict")
	ErrNotConfigured = errors.New("not configured")
)

//go:embed schema.sql
var schema string

type Store struct{ Pool *pgxpool.Pool }
type Participant struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
}
type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}
type Message struct {
	ID        string    `json:"id"`
	Sequence  int64     `json:"sequence"`
	ChannelID string    `json:"channelId"`
	AuthorID  string    `json:"authorId"`
	Nickname  string    `json:"nickname"`
	RequestID string    `json:"requestId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
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
func (s *Store) Guest(ctx context.Context, nickname, invite string) (Participant, string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Participant{}, "", err
	}
	defer tx.Rollback(ctx)
	var configured, open bool
	if err = tx.QueryRow(ctx, "SELECT configured,open_admission FROM installation WHERE singleton FOR SHARE").Scan(&configured, &open); err != nil {
		return Participant{}, "", err
	}
	if !configured {
		return Participant{}, "", ErrNotConfigured
	}
	if !open {
		tag, e := tx.Exec(ctx, "UPDATE invitations SET remaining=remaining-1 WHERE token_hash=$1 AND remaining>0 AND expires_at>now() AND NOT revoked", digest(invite))
		if e != nil {
			return Participant{}, "", e
		}
		if tag.RowsAffected() != 1 {
			return Participant{}, "", ErrDenied
		}
	}
	p := Participant{ID: uuid.New().String(), Nickname: nickname, Role: "participant"}
	secret := newSecret()
	if _, err = tx.Exec(ctx, "INSERT INTO participants(id,nickname,role,credential_hash) VALUES($1,$2,$3,$4)", p.ID, p.Nickname, p.Role, digest(secret)); err != nil {
		return Participant{}, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return Participant{}, "", err
	}
	return p, secret, nil
}
func (s *Store) GuestIdentity(ctx context.Context, secret string) (Participant, error) {
	if len(secret) != 64 {
		return Participant{}, ErrDenied
	}
	return scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role FROM participants WHERE credential_hash=$1 AND NOT banned", digest(secret)))
}
func (s *Store) AccountIdentity(ctx context.Context, subject string) (Participant, error) {
	return scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role FROM participants WHERE auth_subject=$1 AND NOT banned", subject))
}
func (s *Store) Participant(ctx context.Context, id string) (Participant, error) {
	return scanParticipant(s.Pool.QueryRow(ctx, "SELECT id::text,nickname,role FROM participants WHERE id=$1 AND NOT banned", id))
}
func scanParticipant(row pgx.Row) (Participant, error) {
	var p Participant
	err := row.Scan(&p.ID, &p.Nickname, &p.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return p, err
}
func (s *Store) Channels(ctx context.Context) ([]Channel, error) {
	rows, err := s.Pool.Query(ctx, "SELECT id::text,name,kind FROM channels ORDER BY position,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Channel{}
	for rows.Next() {
		var c Channel
		if err = rows.Scan(&c.ID, &c.Name, &c.Kind); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Store) Invite(ctx context.Context, actor string) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err = owner(ctx, tx, actor); err != nil {
		return "", err
	}
	token := newSecret()
	if _, err = tx.Exec(ctx, "INSERT INTO invitations(id,token_hash,remaining,expires_at) VALUES($1,$2,1,now()+interval '24 hours')", uuid.New().String(), digest(token)); err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}
func owner(ctx context.Context, tx pgx.Tx, id string) error {
	var role string
	err := tx.QueryRow(ctx, "SELECT role FROM participants WHERE id=$1 AND NOT banned FOR SHARE", id).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && role != "owner" {
		return ErrDenied
	}
	return err
}
func (s *Store) Ban(ctx context.Context, actor, target string) error {
	if actor == target {
		return ErrDenied
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = owner(ctx, tx, actor); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "UPDATE participants SET banned=true WHERE id=$1 AND role!='owner'", target)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrDenied
	}
	return tx.Commit(ctx)
}
func (s *Store) Send(ctx context.Context, actor, channel, requestID, body string) (Message, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Message{}, false, err
	}
	defer tx.Rollback(ctx)
	var nickname string
	if err = tx.QueryRow(ctx, "SELECT nickname FROM participants WHERE id=$1 AND NOT banned FOR SHARE", actor).Scan(&nickname); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = ErrDenied
		}
		return Message{}, false, err
	}
	// Serialize sends within a channel so a committed cursor cannot skip a later
	// commit with a previously allocated smaller sequence number.
	var channelID string
	if err = tx.QueryRow(ctx, "SELECT id::text FROM channels WHERE id=$1 AND kind='text' FOR UPDATE", channel).Scan(&channelID); err != nil {
		return Message{}, false, ErrDenied
	}
	var m Message
	row := tx.QueryRow(ctx, "INSERT INTO messages(id,channel_id,author_id,request_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(author_id,request_id) DO NOTHING RETURNING id::text,sequence,channel_id::text,author_id::text,request_id::text,body,created_at", uuid.New().String(), channel, actor, requestID, body)
	fresh := true
	err = scanMessage(row, &m)
	if errors.Is(err, pgx.ErrNoRows) {
		fresh = false
		err = scanMessage(tx.QueryRow(ctx, "SELECT id::text,sequence,channel_id::text,author_id::text,request_id::text,body,created_at FROM messages WHERE author_id=$1 AND request_id=$2", actor, requestID), &m)
	}
	if err != nil {
		return Message{}, false, err
	}
	if m.ChannelID != channel || m.Body != body {
		return Message{}, false, ErrConflict
	}
	m.Nickname = nickname
	if err = tx.Commit(ctx); err != nil {
		return Message{}, false, err
	}
	return m, fresh, nil
}
func scanMessage(row pgx.Row, m *Message) error {
	return row.Scan(&m.ID, &m.Sequence, &m.ChannelID, &m.AuthorID, &m.RequestID, &m.Body, &m.CreatedAt)
}
func (s *Store) History(ctx context.Context, channel string, after int64) ([]Message, error) {
	rows, err := s.Pool.Query(ctx, `SELECT m.id::text,m.sequence,m.channel_id::text,m.author_id::text,m.request_id::text,m.body,m.created_at,p.nickname FROM messages m JOIN participants p ON p.id=m.author_id WHERE m.channel_id=$1 AND m.sequence>$2 ORDER BY m.sequence LIMIT 100`, channel, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.ID, &m.Sequence, &m.ChannelID, &m.AuthorID, &m.RequestID, &m.Body, &m.CreatedAt, &m.Nickname); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}
