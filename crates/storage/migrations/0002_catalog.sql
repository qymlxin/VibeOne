CREATE TABLE catalog (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    value TEXT NOT NULL CHECK(json_valid(value)),
    updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
    PRIMARY KEY(kind,id)
);
