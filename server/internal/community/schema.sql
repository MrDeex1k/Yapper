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
