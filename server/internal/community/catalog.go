package community

import (
	"context"
	"errors"
	"uuid"

	"github.com/jackc/pgx/v5"
)

type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Catalog struct {
	Categories []Category `json:"categories"`
	Channels   []Channel  `json:"channels"`
}

func (s *Store) Catalog(ctx context.Context) (Catalog, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Catalog{}, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT id::text,name FROM categories ORDER BY position,id")
	if err != nil {
		return Catalog{}, err
	}
	categories, err := pgx.AppendRows([]Category{}, rows, pgx.RowToStructByPos[Category])
	if err != nil {
		return Catalog{}, err
	}
	channels, err := channels(ctx, tx)
	return Catalog{Categories: categories, Channels: channels}, err
}

type channelQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (s *Store) Channels(ctx context.Context) ([]Channel, error) {
	return channels(ctx, s.Pool)
}

func channels(ctx context.Context, db channelQuerier) ([]Channel, error) {
	rows, err := db.Query(ctx, `SELECT id::text,name,kind,COALESCE(category_id::text,''),archived
		FROM channels ORDER BY position,id`)
	if err != nil {
		return nil, err
	}
	return pgx.AppendRows([]Channel{}, rows, pgx.RowToStructByPos[Channel])
}

// Catalog writes share the installation lock so relative moves and appends are atomic.
func (s *Store) editCatalog(ctx context.Context, actor string, edit func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SELECT singleton FROM installation WHERE singleton FOR UPDATE"); err != nil {
			return err
		}
		return edit(tx)
	})
}

func (s *Store) SaveCategory(ctx context.Context, actor, id, name string) error {
	return s.editCatalog(ctx, actor, func(tx pgx.Tx) error {
		if id == "" {
			_, err := tx.Exec(ctx, "INSERT INTO categories(id,name,position) SELECT $1,$2,COALESCE(max(position)+1,0) FROM categories", uuid.New().String(), name)
			return err
		}
		tag, err := tx.Exec(ctx, "UPDATE categories SET name=$2 WHERE id=$1", id, name)
		if err == nil && tag.RowsAffected() == 0 {
			err = ErrDenied
		}
		return err
	})
}

func (s *Store) SaveChannel(ctx context.Context, actor, id, name, kind, category string) error {
	return s.editCatalog(ctx, actor, func(tx pgx.Tx) error {
		if category != "" {
			var exists bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT FROM categories WHERE id=$1)", category).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return ErrDenied
			}
		}
		if id == "" {
			_, err := tx.Exec(ctx, `INSERT INTO channels(id,name,kind,category_id,position)
				SELECT $1,$2,$3,NULLIF($4,'')::uuid,COALESCE(max(position)+1,0) FROM channels
				WHERE kind=$3 AND category_id IS NOT DISTINCT FROM NULLIF($4,'')::uuid`, uuid.New().String(), name, kind, category)
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE channels c SET name=$2,category_id=NULLIF($3,'')::uuid,
			position=CASE WHEN category_id IS NOT DISTINCT FROM NULLIF($3,'')::uuid THEN position ELSE
			 (SELECT COALESCE(max(peer.position)+1,0) FROM channels peer WHERE peer.kind=c.kind
			  AND peer.category_id IS NOT DISTINCT FROM NULLIF($3,'')::uuid) END WHERE id=$1`, id, name, category)
		if err == nil && tag.RowsAffected() == 0 {
			err = ErrDenied
		}
		return err
	})
}

func (s *Store) MoveCategory(ctx context.Context, actor, id string, direction int) error {
	return s.editCatalog(ctx, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `WITH ordered AS (
			SELECT id, row_number() OVER (ORDER BY position,id) AS rank FROM categories
		), selected AS (SELECT rank FROM ordered WHERE id=$1)
		UPDATE categories c SET position=CASE WHEN o.rank=selected.rank THEN peer.position ELSE target.position END
		FROM ordered o,selected,categories target,categories peer
		 WHERE c.id=o.id AND target.id=$1 AND o.rank IN (selected.rank,selected.rank+$2)
		 AND peer.id=(SELECT id FROM ordered WHERE rank=selected.rank+$2)`, id, direction)
		return err
	})
}

func (s *Store) MoveChannel(ctx context.Context, actor, id string, direction int) error {
	return s.editCatalog(ctx, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `WITH ordered AS (
			SELECT c.id, row_number() OVER (ORDER BY c.position,c.id) AS rank FROM channels c JOIN channels target
			 ON target.id=$1 AND c.kind=target.kind AND c.category_id IS NOT DISTINCT FROM target.category_id
		), selected AS (SELECT rank FROM ordered WHERE id=$1)
		UPDATE channels c SET position=CASE WHEN o.rank=selected.rank THEN peer.position ELSE target.position END
		FROM ordered o,selected,channels target,channels peer
		 WHERE c.id=o.id AND target.id=$1 AND o.rank IN (selected.rank,selected.rank+$2)
		 AND peer.id=(SELECT id FROM ordered WHERE rank=selected.rank+$2)`, id, direction)
		return err
	})
}

func (s *Store) ArchiveChannel(ctx context.Context, actor, id string) error {
	return s.editCatalog(ctx, actor, func(tx pgx.Tx) error {
		var kind string
		err := tx.QueryRow(ctx, "UPDATE channels SET archived=true WHERE id=$1 RETURNING kind", id).Scan(&kind)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDenied
		}
		if err != nil || kind != "voice" {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE media_sessions SET revoked=true WHERE channel_id=$1", id)
		return err
	})
}
