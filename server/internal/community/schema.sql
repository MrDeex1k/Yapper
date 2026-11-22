CREATE TABLE IF NOT EXISTS installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  name text NOT NULL DEFAULT 'Yapper',
  configured boolean NOT NULL DEFAULT false,
  open_admission boolean NOT NULL DEFAULT false
);
INSERT INTO installation(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY,
  nickname text NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','moderator','participant')),
  auth_subject text UNIQUE,
  credential_hash bytea UNIQUE,
  banned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((auth_subject IS NULL) <> (credential_hash IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON participants(role) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('text','voice')),
  position integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY,
  token_hash bytea UNIQUE NOT NULL,
  remaining integer CHECK(remaining >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);
ALTER TABLE invitations
  ALTER COLUMN remaining DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS messages (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid UNIQUE NOT NULL,
  channel_id uuid NOT NULL REFERENCES channels(id),
  author_id uuid NOT NULL REFERENCES participants(id),
  request_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(author_id, request_id)
);
CREATE INDEX IF NOT EXISTS messages_channel_sequence ON messages(channel_id,sequence DESC);
CREATE TABLE IF NOT EXISTS media_sessions (
 participant_id uuid PRIMARY KEY REFERENCES participants(id),
 identity text UNIQUE NOT NULL,
 channel_id uuid NOT NULL REFERENCES channels(id),
 auth_subject text NOT NULL DEFAULT '',
 auth_session_id text NOT NULL DEFAULT '',
 revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS media_removals (
 identity text PRIMARY KEY,
 participant_id uuid NOT NULL REFERENCES participants(id),
 channel_id uuid NOT NULL REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS categories (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 position integer NOT NULL
);
ALTER TABLE channels
 ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id),
 ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

ALTER TABLE participants
 ADD COLUMN IF NOT EXISTS kick_generation bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS mic_muted boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS last_ip inet,
 ADD COLUMN IF NOT EXISTS last_ip_observed_at timestamptz;
ALTER TABLE media_sessions
 ADD COLUMN IF NOT EXISTS client_ip inet,
 ADD COLUMN IF NOT EXISTS resume_from text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ip_blocks (
 participant_id uuid NOT NULL REFERENCES participants(id),
 address inet NOT NULL,
 PRIMARY KEY (participant_id,address)
);
CREATE INDEX IF NOT EXISTS ip_blocks_address ON ip_blocks(address);
CREATE TABLE IF NOT EXISTS moderation_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES participants(id),
 target_id uuid NOT NULL REFERENCES participants(id),
 action text NOT NULL,
 ip_blocked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS message_revisions;
ALTER TABLE messages
 ALTER COLUMN body DROP NOT NULL,
 ADD COLUMN IF NOT EXISTS original_body_hash bytea,
 ADD COLUMN IF NOT EXISTS edited_at timestamptz,
 ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS messages_channel_revision ON messages(channel_id,revision);
CREATE INDEX IF NOT EXISTS messages_live_age ON messages(created_at,channel_id) WHERE body IS NOT NULL;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS message_retention_days integer NOT NULL DEFAULT 0
 CHECK(message_retention_days BETWEEN 0 AND 36500);
ALTER TABLE moderation_audit ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES messages(id);
