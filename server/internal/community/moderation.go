package community

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"
	"uuid"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrBanned    = fmt.Errorf("participant banned: %w", ErrDenied)
	ErrIPBlocked = fmt.Errorf("guest address blocked: %w", ErrDenied)
	ErrNoGuestIP = errors.New("no verified guest address")
)

type ModerationAction string

const (
	Kick            ModerationAction = "kick"
	Ban             ModerationAction = "ban"
	Unban           ModerationAction = "unban"
	Mute            ModerationAction = "mute"
	Unmute          ModerationAction = "unmute"
	GrantModerator  ModerationAction = "grant_moderator"
	RevokeModerator ModerationAction = "revoke_moderator"
)

func (a ModerationAction) Valid() bool {
	switch a {
	case Kick, Ban, Unban, Mute, Unmute, GrantModerator, RevokeModerator:
		return true
	}
	return false
}

type Member struct {
	ID         string `json:"id"`
	Nickname   string `json:"nickname"`
	Role       string `json:"role"`
	Banned     bool   `json:"banned"`
	MicMuted   bool   `json:"micMuted"`
	Registered bool   `json:"registered"`
	CanBlockIP bool   `json:"canBlockIp"`
	IPBlocked  bool   `json:"ipBlocked"`
}
type MemberPage struct {
	Members []Member `json:"members"`
	Next    string   `json:"next"`
}
type AuditEvent struct {
	Action    string    `json:"action"`
	ActorID   string    `json:"actorId"`
	TargetID  string    `json:"targetId"`
	IPBlocked bool      `json:"ipBlocked"`
	CreatedAt time.Time `json:"createdAt"`
}

func staff(ctx context.Context, tx pgx.Tx, id string) (string, error) {
	var role string
	err := tx.QueryRow(ctx, "SELECT role FROM participants WHERE id=$1 AND NOT banned FOR SHARE", id).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && role != "owner" && role != "moderator" {
		return "", ErrDenied
	}
	return role, err
}

func (s *Store) Members(ctx context.Context, actor, after, target string) (MemberPage, error) {
	const pageSize = 50
	var result MemberPage
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := staff(ctx, tx, actor); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT p.id::text,p.nickname,p.role,p.banned,p.mic_muted,
			p.auth_subject IS NOT NULL,p.last_ip IS NOT NULL,
			EXISTS(SELECT FROM ip_blocks b WHERE b.participant_id=p.id)
			FROM participants p WHERE (NULLIF($1,'') IS NULL OR p.id>NULLIF($1,'')::uuid)
			AND (NULLIF($2,'') IS NULL OR p.id=NULLIF($2,'')::uuid)
			ORDER BY p.id LIMIT $3`, after, target, pageSize+1)
		if err != nil {
			return err
		}
		result.Members, err = pgx.AppendRows([]Member{}, rows, pgx.RowToStructByPos[Member])
		if len(result.Members) > pageSize {
			result.Members = result.Members[:pageSize]
			result.Next = result.Members[pageSize-1].ID
		}
		return err
	})
	return result, err
}

func (s *Store) Audit(ctx context.Context, actor string) ([]AuditEvent, error) {
	var result []AuditEvent
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := staff(ctx, tx, actor); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT action,actor_id::text,target_id::text,ip_blocked,created_at
			FROM moderation_audit ORDER BY sequence DESC LIMIT 100`)
		if err != nil {
			return err
		}
		result, err = pgx.AppendRows([]AuditEvent{}, rows, pgx.RowToStructByPos[AuditEvent])
		return err
	})
	return result, err
}

// ProvisionModerator retries an already-created AUTH account without restoring an
// existing community binding's privileges. Explicit role changes use Moderate.
func (s *Store) ProvisionModerator(ctx context.Context, actor, username string, provision func(context.Context) (string, error)) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := owner(ctx, tx, actor); err != nil {
			return err
		}
		subject, err := provision(ctx)
		if err != nil {
			return err
		}
		id := uuid.New().String()
		tag, err := tx.Exec(ctx, `INSERT INTO participants(id,nickname,role,auth_subject)
			VALUES($1,$2,'moderator',$3) ON CONFLICT(auth_subject) DO NOTHING`, id, username, subject)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return recordModeration(ctx, tx, actor, id, "provision_moderator", false)
	})
}

func recordModeration(ctx context.Context, tx pgx.Tx, actor, target, action string, blocked bool) error {
	_, err := tx.Exec(ctx, `INSERT INTO moderation_audit(actor_id,target_id,action,ip_blocked) VALUES($1,$2,$3,$4)`, actor, target, action, blocked)
	return err
}

// Moderate changes membership and invalidates affected media grants atomically.
func (s *Store) Moderate(ctx context.Context, actor, target string, action ModerationAction, blockIP bool) ([]MediaSession, error) {
	if actor == target || !action.Valid() || blockIP && action != Ban {
		return nil, ErrDenied
	}
	var revoked []MediaSession
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		role, err := staff(ctx, tx, actor)
		if err != nil {
			return err
		}
		moderatorChange := action == GrantModerator || action == RevokeModerator
		if moderatorChange && role != "owner" {
			return ErrDenied
		}
		var banned, muted, registered bool
		var targetRole string
		var address netip.Addr
		err = tx.QueryRow(ctx, `SELECT role,banned,mic_muted,auth_subject IS NOT NULL,last_ip
			FROM participants WHERE id=$1 AND role!='owner' AND ($2='owner' OR role='participant') FOR UPDATE`, target, role).
			Scan(&targetRole, &banned, &muted, &registered, &address)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && (banned && action != Ban && action != Unban || moderatorChange && !registered) {
			return ErrDenied
		}
		if err != nil {
			return err
		}
		if blockIP && (registered || !address.IsValid()) {
			return ErrNoGuestIP
		}
		var changed bool
		var blockedAddress netip.Addr
		switch action {
		case Kick:
			_, err = tx.Exec(ctx, "UPDATE participants SET kick_generation=kick_generation+1 WHERE id=$1", target)
			changed = true
		case Ban:
			_, err = tx.Exec(ctx, "UPDATE participants SET banned=true,kick_generation=kick_generation+1 WHERE id=$1 AND NOT banned", target)
			changed = !banned
			if err == nil && blockIP {
				var tag pgconn.CommandTag
				tag, err = tx.Exec(ctx, "INSERT INTO ip_blocks(participant_id,address) VALUES($1,$2) ON CONFLICT DO NOTHING", target, address)
				changed = changed || tag.RowsAffected() != 0
				blockedAddress = address
			}
		case Unban:
			_, err = tx.Exec(ctx, "UPDATE participants SET banned=false WHERE id=$1", target)
			if err == nil {
				_, err = tx.Exec(ctx, "DELETE FROM ip_blocks WHERE participant_id=$1", target)
			}
			changed = banned
		case Mute, Unmute:
			next := action == Mute
			_, err = tx.Exec(ctx, "UPDATE participants SET mic_muted=$2 WHERE id=$1", target, next)
			changed = muted != next
		case GrantModerator, RevokeModerator:
			next := "participant"
			if action == GrantModerator {
				next = "moderator"
			}
			_, err = tx.Exec(ctx, "UPDATE participants SET role=$2 WHERE id=$1", target, next)
			changed = targetRole != next
		}
		if err != nil || !changed {
			return err
		}
		if action == Kick || action == Ban || action == Mute || action == Unmute {
			rows, err := tx.Query(ctx, `UPDATE media_sessions SET revoked=true
				WHERE NOT revoked AND (participant_id=$1 OR (auth_subject='' AND client_ip=$2))
				RETURNING participant_id::text,identity,channel_id::text`, target, blockedAddress)
			if err != nil {
				return err
			}
			for rows.Next() {
				var session MediaSession
				if err := rows.Scan(&session.ParticipantID, &session.Identity, &session.ChannelID); err != nil {
					rows.Close()
					return err
				}
				revoked = append(revoked, session)
			}
			if err := rows.Err(); err != nil {
				return err
			}
		}
		return recordModeration(ctx, tx, actor, target, string(action), blockIP)
	})
	return revoked, err
}

type addressQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func checkGuestAddress(ctx context.Context, db addressQuerier, address netip.Addr) error {
	if !address.IsValid() {
		return nil
	}
	var blocked bool
	err := db.QueryRow(ctx, "SELECT EXISTS(SELECT FROM ip_blocks WHERE address=$1)", address).Scan(&blocked)
	if err == nil && blocked {
		return ErrIPBlocked
	}
	return err
}

func (s *Store) CheckGuestAddress(ctx context.Context, address netip.Addr) error {
	return checkGuestAddress(ctx, s.Pool, address)
}
