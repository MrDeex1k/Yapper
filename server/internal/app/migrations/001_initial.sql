CREATE TABLE users (
 id text PRIMARY KEY,
 username text NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 32),
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
 banned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE invites (
 token_hash text PRIMARY KEY,
 created_by text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE TABLE channels (
 id text PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
 kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice')),
 private boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE channel_members (
 channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(channel_id,user_id)
);
CREATE TABLE messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id),
 content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
 client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,channel_id,client_id)
);
CREATE INDEX messages_history ON messages(channel_id,id DESC);
