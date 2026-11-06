CREATE TABLE notification_outbox (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX pending_notifications ON notification_outbox(state,available_at);
