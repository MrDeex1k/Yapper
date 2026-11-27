package community

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"uuid"

	"github.com/jackc/pgx/v5"
)

type MediaSession struct {
	ParticipantID string
	Identity      string
	ChannelID     string
	AuthSubject   string
	AuthSessionID string
	Nickname      string
	MicMuted      bool
}

var ErrVoiceResumePending = fmt.Errorf("voice resume pending: %w", ErrDenied)

func (s *Store) StartVoice(ctx context.Context, actor Participant, channel, subject, sessionID, resumeIdentity string, address netip.Addr, remove func(context.Context, MediaSession) error) (MediaSession, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return MediaSession{}, err
	}
	defer tx.Rollback(ctx)
	if subject == "" {
		if err := lockGuestAddresses(ctx, tx, false); err != nil {
			return MediaSession{}, err
		}
	}
	id := actor.ID
	var nickname string
	var muted bool
	if err = tx.QueryRow(ctx, "SELECT nickname,mic_muted FROM participants WHERE id=$1 AND NOT banned AND kick_generation=$2 FOR UPDATE", id, actor.KickGeneration).Scan(&nickname, &muted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = ErrDenied
		}
		return MediaSession{}, err
	}
	if subject != "" {
		address = netip.Addr{}
	}
	if err := checkGuestAddress(ctx, tx, address); err != nil {
		return MediaSession{}, err
	}
	var channelID string
	err = tx.QueryRow(ctx, "SELECT id::text FROM channels WHERE id=$1 AND kind='voice' AND NOT archived FOR SHARE", channel).Scan(&channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MediaSession{}, ErrDenied
	}
	if err != nil {
		return MediaSession{}, err
	}
	var old MediaSession
	var revoked bool
	var pendingResume, oldSubject, oldSession string
	err = tx.QueryRow(ctx, "SELECT participant_id::text,identity,channel_id::text,revoked,resume_from,auth_subject,auth_session_id FROM media_sessions WHERE participant_id=$1 FOR UPDATE", id).
		Scan(&old.ParticipantID, &old.Identity, &old.ChannelID, &revoked, &pendingResume, &oldSubject, &oldSession)
	hadOld := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return MediaSession{}, err
	}
	// Retry the same pending replacement until the earlier grant has been removed.
	retrying := resumeIdentity != "" && pendingResume == resumeIdentity
	if resumeIdentity != "" && (!hadOld || revoked || old.ChannelID != channel ||
		oldSubject != subject || oldSession != sessionID || !retrying && old.Identity != resumeIdentity) {
		return MediaSession{}, ErrDenied
	}
	session := MediaSession{ParticipantID: id, Identity: id + ":" + uuid.New().String(), ChannelID: channel, AuthSubject: subject, AuthSessionID: sessionID, Nickname: nickname, MicMuted: muted}
	if retrying {
		session.Identity = old.Identity
	}
	_, err = tx.Exec(ctx, `INSERT INTO media_sessions(participant_id,identity,channel_id,auth_subject,auth_session_id,client_ip,resume_from)
		VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(participant_id) DO UPDATE SET identity=EXCLUDED.identity,
		channel_id=EXCLUDED.channel_id,auth_subject=EXCLUDED.auth_subject,auth_session_id=EXCLUDED.auth_session_id,
		client_ip=EXCLUDED.client_ip,resume_from=EXCLUDED.resume_from,revoked=false`, id, session.Identity, channel, subject, sessionID, address, resumeIdentity)
	if err != nil {
		return MediaSession{}, err
	}
	if hadOld && !retrying {
		_, err = tx.Exec(ctx, "INSERT INTO media_removals(participant_id,identity,channel_id) VALUES($1,$2,$3) ON CONFLICT(identity) DO NOTHING", old.ParticipantID, old.Identity, old.ChannelID)
		if err != nil {
			return MediaSession{}, err
		}
	}
	pending, err := pendingVoiceRemovals(ctx, tx, id)
	if err != nil {
		return MediaSession{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MediaSession{}, err
	}
	for _, stale := range pending {
		if err = remove(ctx, stale); err != nil {
			return MediaSession{}, err
		}
		if err = s.ForgetVoiceRemoval(ctx, stale.Identity); err != nil {
			return MediaSession{}, err
		}
	}
	// A moderation action or a newer join can win while cleanup is in flight.
	tag, err := s.Pool.Exec(ctx, `UPDATE media_sessions SET resume_from=''
		WHERE identity=$1 AND NOT revoked AND resume_from=$2
		AND NOT EXISTS (SELECT FROM media_removals WHERE participant_id=$3)`, session.Identity, resumeIdentity, id)
	if err != nil {
		return MediaSession{}, err
	}
	if tag.RowsAffected() != 1 {
		return MediaSession{}, ErrDenied
	}
	return s.VoiceSession(ctx, session.Identity)
}
func (s *Store) VoiceSession(ctx context.Context, identity string) (MediaSession, error) {
	var m MediaSession
	var pending bool
	err := s.Pool.QueryRow(ctx, `SELECT m.participant_id::text,m.identity,m.channel_id::text,
		m.auth_subject,m.auth_session_id,p.nickname,p.mic_muted,m.resume_from<>''
		FROM media_sessions m JOIN participants p ON p.id=m.participant_id
		WHERE m.identity=$1 AND NOT m.revoked AND NOT p.banned
		AND (m.auth_subject!='' OR NOT EXISTS(SELECT FROM ip_blocks b WHERE b.address=m.client_ip))`, identity).
		Scan(&m.ParticipantID, &m.Identity, &m.ChannelID, &m.AuthSubject, &m.AuthSessionID, &m.Nickname, &m.MicMuted, &pending)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	} else if err == nil && pending {
		err = ErrVoiceResumePending
	}
	return m, err
}

// RecordVoiceAddress fences signaling upgrades from a newly blocked guest address.
func (s *Store) RecordVoiceAddress(ctx context.Context, mediaIdentity string, address netip.Addr) error {
	if !address.IsValid() {
		return nil
	}
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lockGuestAddresses(ctx, tx, false); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE media_sessions SET client_ip=$2
			WHERE identity=$1 AND NOT revoked AND NOT EXISTS(SELECT FROM ip_blocks WHERE address=$2)`, mediaIdentity, address)
		if err == nil && tag.RowsAffected() != 1 {
			return ErrDenied
		}
		return err
	})
}

func (s *Store) RevokeVoice(ctx context.Context, participantID string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, "UPDATE media_sessions SET revoked=true WHERE participant_id=$1 RETURNING participant_id::text,identity,channel_id::text", participantID).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID)
	return m, err
}
func (s *Store) ForgetVoice(ctx context.Context, identity string) error {
	_, err := s.Pool.Exec(ctx, "DELETE FROM media_sessions WHERE identity=$1 AND revoked", identity)
	return err
}
func (s *Store) AllVoiceSessions(ctx context.Context) ([]MediaSession, error) {
	rows, err := s.Pool.Query(ctx, "SELECT participant_id::text,identity,channel_id::text,auth_subject,auth_session_id FROM media_sessions")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MediaSession{}
	for rows.Next() {
		var m MediaSession
		if err = rows.Scan(&m.ParticipantID, &m.Identity, &m.ChannelID, &m.AuthSubject, &m.AuthSessionID); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (s *Store) RevokeVoiceIdentity(ctx context.Context, identity string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, "UPDATE media_sessions SET revoked=true WHERE identity=$1 RETURNING participant_id::text,identity,channel_id::text", identity).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID)
	return m, err
}

func (s *Store) RevokeOwnedVoice(ctx context.Context, participantID, mediaIdentity string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, "UPDATE media_sessions SET revoked=true WHERE participant_id=$1 AND (identity=$2 OR resume_from=$2) RETURNING participant_id::text,identity,channel_id::text", participantID, mediaIdentity).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID)
	return m, err
}

func (s *Store) PendingVoiceRemovals(ctx context.Context) ([]MediaSession, error) {
	return pendingVoiceRemovals(ctx, s.Pool, "")
}

func pendingVoiceRemovals(ctx context.Context, db rowQuerier, participant string) ([]MediaSession, error) {
	rows, err := db.Query(ctx, `SELECT participant_id::text,identity,channel_id::text FROM media_removals
		WHERE NULLIF($1,'') IS NULL OR participant_id=NULLIF($1,'')::uuid`, participant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []MediaSession
	for rows.Next() {
		var m MediaSession
		if err := rows.Scan(&m.ParticipantID, &m.Identity, &m.ChannelID); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}
func (s *Store) ForgetVoiceRemoval(ctx context.Context, identity string) error {
	_, err := s.Pool.Exec(ctx, "DELETE FROM media_removals WHERE identity=$1", identity)
	return err
}
