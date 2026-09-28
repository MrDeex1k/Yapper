CREATE TABLE attachments (
 id text PRIMARY KEY,
 channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id),
 filename text NOT NULL,
 bytes bigint NOT NULL CHECK(bytes >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_channel_idx ON attachments(channel_id);
ALTER TABLE messages ADD COLUMN file_id text REFERENCES attachments(id) ON DELETE SET NULL;
