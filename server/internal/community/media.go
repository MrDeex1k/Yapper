package community

import (
	"context"
	"errors"
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
}

func (s *Store) StartVoice(ctx context.Context, id, channel, subject, sessionID string, remove func(context.Context, MediaSession) error) (MediaSession, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return MediaSession{}, err
	}
	defer tx.Rollback(ctx)
	var nickname string
	if err = tx.QueryRow(ctx, "SELECT nickname FROM participants WHERE id=$1 AND NOT banned FOR UPDATE", id).Scan(&nickname); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = ErrDenied
		}
		return MediaSession{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND kind='voice')", channel).Scan(&exists); err != nil {
		return MediaSession{}, err
	}
	if !exists {
		return MediaSession{}, ErrDenied
	}
	var old MediaSession
	err = tx.QueryRow(ctx, "SELECT participant_id::text,identity,channel_id::text FROM media_sessions WHERE participant_id=$1", id).Scan(&old.ParticipantID, &old.Identity, &old.ChannelID)
	if err == nil {
		if err = remove(ctx, old); err != nil {
			return MediaSession{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return MediaSession{}, err
	}
	session := MediaSession{ParticipantID: id, Identity: id + ":" + uuid.New().String(), ChannelID: channel, AuthSubject: subject, AuthSessionID: sessionID, Nickname: nickname}
	_, err = tx.Exec(ctx, `INSERT INTO media_sessions(participant_id,identity,channel_id,auth_subject,auth_session_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(participant_id) DO UPDATE SET identity=EXCLUDED.identity,channel_id=EXCLUDED.channel_id,auth_subject=EXCLUDED.auth_subject,auth_session_id=EXCLUDED.auth_session_id,revoked=false`, id, session.Identity, channel, subject, sessionID)
	if err != nil {
		return MediaSession{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MediaSession{}, err
	}
	return session, nil
}
func (s *Store) VoiceSession(ctx context.Context, identity string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, `SELECT m.participant_id::text,m.identity,m.channel_id::text,m.auth_subject,m.auth_session_id,p.nickname FROM media_sessions m JOIN participants p ON p.id=m.participant_id WHERE m.identity=$1 AND NOT m.revoked AND NOT p.banned`, identity).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID, &m.AuthSubject, &m.AuthSessionID, &m.Nickname)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrDenied
	}
	return m, err
}
func (s *Store) RevokeVoice(ctx context.Context, id string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, "UPDATE media_sessions SET revoked=true WHERE participant_id=$1 RETURNING participant_id::text,identity,channel_id::text", id).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID)
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

func (s *Store) RevokeOwnedVoice(ctx context.Context, id, identity string) (MediaSession, error) {
	var m MediaSession
	err := s.Pool.QueryRow(ctx, "UPDATE media_sessions SET revoked=true WHERE participant_id=$1 AND identity=$2 RETURNING participant_id::text,identity,channel_id::text", id, identity).Scan(&m.ParticipantID, &m.Identity, &m.ChannelID)
	return m, err
}
