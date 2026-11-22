package community

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

const MaxRetentionDays = 36500

func (s *Store) MessageRetention(ctx context.Context, actor string) (int, error) {
	var days int
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT message_retention_days FROM installation WHERE singleton").Scan(&days)
	})
	return days, err
}

func (s *Store) SetMessageRetention(ctx context.Context, actor string, days int) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "UPDATE installation SET message_retention_days=$1 WHERE singleton", days)
		return err
	})
}

// ExpireMessages erases one bounded batch in one channel and preserves identifiers
// used by sync cursors, moderation and deduplication.
func (s *Store) ExpireMessages(ctx context.Context) (string, error) {
	var channel string
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var days int
		if err := tx.QueryRow(ctx, "SELECT message_retention_days FROM installation WHERE singleton FOR SHARE").Scan(&days); err != nil || days == 0 {
			return err
		}
		const eligible = "body IS NOT NULL AND created_at < transaction_timestamp()-($1::integer * interval '24 hours')"
		err := tx.QueryRow(ctx, "SELECT channel_id::text FROM messages WHERE "+eligible+" ORDER BY created_at LIMIT 1", days).Scan(&channel)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := lockMessageChannel(ctx, tx, channel); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, redactMessage+` WHERE id IN (SELECT id FROM messages WHERE `+eligible+
			` AND channel_id=$2 ORDER BY created_at,sequence LIMIT 250)`, days, channel)
		return err
	})
	return channel, err
}
