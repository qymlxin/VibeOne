CREATE TABLE workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_path TEXT NOT NULL REFERENCES workspaces(path),
    revision INTEGER NOT NULL CHECK (revision > 0),
    snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE event_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX session_events ON event_log(session_id, seq);
