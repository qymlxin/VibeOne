CREATE TABLE conversation_records (
 session_id TEXT NOT NULL REFERENCES sessions(id),
 history_order INTEGER NOT NULL CHECK(history_order > 0),
 history_revision INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('message','tool')),
 record_id TEXT NOT NULL,
 role TEXT NOT NULL,
 run_id TEXT NOT NULL,
 pending INTEGER NOT NULL DEFAULT 0,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 PRIMARY KEY(session_id,history_order)
);
CREATE INDEX history_identity ON conversation_records(session_id,kind,record_id,role,run_id);
CREATE TABLE conversation_history_state (
 session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),
 state TEXT NOT NULL CHECK(json_valid(state))
);
