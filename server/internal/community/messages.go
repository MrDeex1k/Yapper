package community

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"uuid"

	"github.com/jackc/pgx/v5"
)

const messageFields = `m.id::text,m.sequence,m.channel_id::text,m.author_id::text,p.nickname,
	m.request_id::text,m.body,m.created_at,m.edited_at,m.revision,m.original_body_hash`
const messageRows = ` FROM messages m JOIN participants p ON p.id=m.author_id `
const pageSize = 50
const changeBatch = 100

type messageRecord struct {
	Message
	deleted      bool
	originalHash []byte
}

type HistoryPage struct {
	Messages []Message `json:"messages"`
	Before   int64     `json:"before"`
	Revision int64     `json:"revision"`
}

type MessageChange struct {
	ID       string   `json:"id"`
	Revision int64    `json:"revision"`
	Message  *Message `json:"message"`
}

func readMessage(row pgx.Row, extra ...any) (messageRecord, error) {
	var r messageRecord
	var body *string
	fields := []any{
		&r.ID, &r.Sequence, &r.ChannelID, &r.AuthorID, &r.Nickname, &r.RequestID, &body,
		&r.CreatedAt, &r.EditedAt, &r.Revision, &r.originalHash,
	}
	err := row.Scan(append(fields, extra...)...)
	r.deleted = body == nil
	if body != nil {
		r.Body = *body
	}
	return r, err
}

func collectMessages(rows pgx.Rows) ([]Message, error) {
	return pgx.AppendRows([]Message{}, rows, func(row pgx.CollectableRow) (Message, error) {
		m, err := readMessage(row)
		return m.Message, err
	})
}

func chatActor(ctx context.Context, tx pgx.Tx, id string) (string, error) {
	var role string
	err := tx.QueryRow(ctx, "SELECT role FROM participants WHERE id=$1 AND NOT banned FOR SHARE", id).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return role, err
}

// Every channel write takes this lock before allocating either cursor. Readers
// will never miss a later commit with a lower cursor within the same channel.
func lockMessageChannel(ctx context.Context, tx pgx.Tx, channel string) (bool, error) {
	var archived bool
	err := tx.QueryRow(ctx, "SELECT archived FROM channels WHERE id=$1 AND kind='text' FOR UPDATE", channel).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return archived, err
}

func (s *Store) Send(ctx context.Context, actor, channel, requestID, body string) (Message, bool, error) {
	var message Message
	var fresh bool
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := chatActor(ctx, tx, actor); err != nil {
			return err
		}
		archived, err := lockMessageChannel(ctx, tx, channel)
		if err != nil {
			return err
		}
		if archived {
			return ErrDenied
		}
		r, err := readMessage(tx.QueryRow(ctx, `
			WITH sent AS (
				INSERT INTO messages(id,channel_id,author_id,request_id,body,revision)
				VALUES($1,$2,$3,$4,$5,nextval('message_revisions'))
				ON CONFLICT(author_id,request_id) DO SELECT
				RETURNING messages.*, OLD.id IS NULL AS inserted
			)
			SELECT `+messageFields+`,m.inserted
			FROM sent m JOIN participants p ON p.id=m.author_id`,
			uuid.New().String(), channel, actor, requestID, body), &fresh)
		if err != nil {
			return err
		}
		if r.ChannelID != channel {
			return ErrConflict
		}
		if r.deleted {
			return ErrMessageGone
		}
		if !fresh {
			hash := r.originalHash
			if hash == nil {
				hash = digest(r.Body)
			}
			if !bytes.Equal(hash, digest(body)) {
				return ErrConflict
			}
		}
		message = r.Message
		return nil
	})
	return message, fresh, err
}

func (s *Store) History(ctx context.Context, channel string, after int64) ([]Message, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+messageFields+messageRows+
		" WHERE m.channel_id=$1 AND m.body IS NOT NULL AND m.sequence>$2 ORDER BY m.sequence LIMIT 100", channel, after)
	if err != nil {
		return nil, err
	}
	return collectMessages(rows)
}

func (s *Store) HistoryPage(ctx context.Context, channel string, before int64) (HistoryPage, error) {
	var page HistoryPage
	err := pgx.BeginTxFunc(ctx, s.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, "SELECT COALESCE(max(revision),0) FROM messages WHERE channel_id=$1", channel).Scan(&page.Revision)
		if err != nil {
			return err
		}
		query := "SELECT " + messageFields + messageRows + " WHERE m.channel_id=$1 AND m.body IS NOT NULL"
		args := []any{channel, pageSize + 1}
		if before != 0 {
			// Keep the cursor as an index bound even in a generic prepared plan.
			query += " AND m.sequence<$3"
			args = append(args, before)
		}
		rows, err := tx.Query(ctx, query+" ORDER BY m.sequence DESC LIMIT $2", args...)
		if err != nil {
			return err
		}
		page.Messages, err = collectMessages(rows)
		if len(page.Messages) > pageSize {
			page.Messages = page.Messages[:pageSize]
			page.Before = page.Messages[pageSize-1].Sequence
		}
		slices.Reverse(page.Messages)
		return err
	})
	return page, err
}

func (s *Store) MessageChanges(ctx context.Context, channel string, after int64) ([]MessageChange, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+messageFields+messageRows+
		" WHERE m.channel_id=$1 AND m.revision>$2 ORDER BY m.revision LIMIT $3", channel, after, changeBatch)
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]MessageChange{}, rows, func(row pgx.CollectableRow) (MessageChange, error) {
		r, err := readMessage(row)
		change := MessageChange{ID: r.ID, Revision: r.Revision}
		if !r.deleted {
			change.Message = &r.Message
		}
		return change, err
	})
}

func editTarget(ctx context.Context, tx pgx.Tx, channel, id string) (messageRecord, error) {
	m, err := readMessage(tx.QueryRow(ctx, "SELECT "+messageFields+messageRows+" WHERE m.channel_id=$1 AND m.id=$2", channel, id))
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrMessageGone
	}
	return m, err
}

func (s *Store) EditMessage(ctx context.Context, actor, channel, id, body string, revision int64) (bool, error) {
	var changed bool
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := chatActor(ctx, tx, actor); err != nil {
			return err
		}
		archived, err := lockMessageChannel(ctx, tx, channel)
		if err != nil {
			return err
		}
		if archived {
			return ErrDenied
		}
		m, err := editTarget(ctx, tx, channel, id)
		if err != nil {
			return err
		}
		if m.AuthorID != actor {
			return ErrDenied
		}
		if m.deleted {
			return ErrMessageGone
		}
		if m.Body == body {
			return nil
		}
		if m.Revision != revision {
			return ErrConflict
		}
		_, err = tx.Exec(ctx, `UPDATE messages SET body=$2,original_body_hash=COALESCE(original_body_hash,$3),
			edited_at=clock_timestamp(),revision=nextval('message_revisions') WHERE id=$1`, id, body, digest(m.Body))
		changed = err == nil
		return err
	})
	return changed, err
}

const redactMessage = "UPDATE messages SET body=NULL, original_body_hash=NULL, edited_at=NULL, revision=nextval('message_revisions')"

func (s *Store) DeleteMessage(ctx context.Context, actor, channel, id string) (bool, error) {
	var changed bool
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		role, err := chatActor(ctx, tx, actor)
		if err != nil {
			return err
		}
		if _, err := lockMessageChannel(ctx, tx, channel); err != nil {
			return err
		}
		m, err := editTarget(ctx, tx, channel, id)
		if err != nil {
			return err
		}
		if m.AuthorID != actor && role != "owner" && role != "moderator" {
			return ErrDenied
		}
		if m.deleted {
			return nil
		}
		if _, err := tx.Exec(ctx, redactMessage+" WHERE id=$1", id); err != nil {
			return err
		}
		if m.AuthorID != actor {
			if _, err := tx.Exec(ctx, `INSERT INTO moderation_audit(actor_id,target_id,action,message_id)
				VALUES($1,$2,'delete_message',$3)`, actor, m.AuthorID, id); err != nil {
				return err
			}
		}
		changed = true
		return nil
	})
	return changed, err
}
