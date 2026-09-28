CREATE TABLE media_grants (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 session_hash text NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,channel_id)
);
