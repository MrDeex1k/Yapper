package community

import (
	"context"
	"time"
	"uuid"

	"github.com/jackc/pgx/v5"
)

type InvitationOptions struct {
	// Zero represents an invitation without an expiration or usage limit.
	ExpiresInHours int32
	MaxUses        int32
}

type Invitation struct {
	ID        string     `json:"id"`
	Remaining *int32     `json:"remaining"`
	ExpiresAt *time.Time `json:"expiresAt"`
	CreatedAt time.Time  `json:"createdAt"`
	Revoked   bool       `json:"revoked"`
}

func (s *Store) SetOpenAdmission(ctx context.Context, actor string, open bool) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "UPDATE installation SET open_admission=$1 WHERE singleton", open)
		return err
	})
}

type CreatedInvitation struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

func (s *Store) Invite(ctx context.Context, actor string, options InvitationOptions) (string, error) {
	invitation, err := s.CreateInvitation(ctx, actor, options)
	return invitation.Token, err
}

func (s *Store) CreateInvitation(ctx context.Context, actor string, options InvitationOptions) (CreatedInvitation, error) {
	invitation := CreatedInvitation{ID: uuid.New().String(), Token: newSecret()}
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO invitations(id,token_hash,remaining,expires_at)
			VALUES($1,$2,NULLIF($3::integer,0),now()+make_interval(hours => NULLIF($4::integer,0)))`,
			invitation.ID, digest(invitation.Token), options.MaxUses, options.ExpiresInHours)
		return err
	})
	if err != nil {
		return CreatedInvitation{}, err
	}
	return invitation, nil
}

func (s *Store) Invitations(ctx context.Context, actor string) ([]Invitation, error) {
	invitations := []Invitation{}
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id::text, remaining, expires_at, created_at, revoked
			FROM invitations ORDER BY created_at DESC, id DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var invitation Invitation
			if err := rows.Scan(&invitation.ID, &invitation.Remaining, &invitation.ExpiresAt, &invitation.CreatedAt, &invitation.Revoked); err != nil {
				return err
			}
			invitations = append(invitations, invitation)
		}
		return rows.Err()
	})
	return invitations, err
}

func (s *Store) RevokeInvitation(ctx context.Context, actor, id string) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, "UPDATE invitations SET revoked=true WHERE id=$1", id)
		if err == nil && tag.RowsAffected() != 1 {
			return ErrDenied
		}
		return err
	})
}
