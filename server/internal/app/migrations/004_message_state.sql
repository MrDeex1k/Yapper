CREATE INDEX messages_search_idx ON messages USING gin(to_tsvector('simple',content));
ALTER TABLE messages ADD COLUMN edited_at timestamptz;
ALTER TABLE messages ADD COLUMN original_content text;
UPDATE messages SET original_content=content;
ALTER TABLE messages ALTER COLUMN original_content SET NOT NULL;
CREATE TABLE read_states (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 last_message_id bigint NOT NULL CHECK(last_message_id>0),
 PRIMARY KEY(user_id,channel_id)
);
