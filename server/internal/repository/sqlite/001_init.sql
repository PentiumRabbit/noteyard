CREATE TABLE IF NOT EXISTS pages (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    icon        TEXT,
    cover       TEXT,
    order_index REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, order_index);

CREATE TABLE IF NOT EXISTS blocks (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '{}',
    order_index     REAL NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id, order_index);

CREATE TABLE IF NOT EXISTS migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
