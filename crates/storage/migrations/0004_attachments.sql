CREATE TABLE attachments (
 id TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL REFERENCES sessions(id),
 name TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 kind TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size >= 0 AND size <= 4194304),
 data BLOB NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 UNIQUE(session_id,sha256,name)
);
CREATE INDEX session_attachments ON attachments(session_id);
