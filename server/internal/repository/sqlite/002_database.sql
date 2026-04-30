CREATE TABLE IF NOT EXISTS databases (
    id          TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_databases_page ON databases(page_id);

CREATE TABLE IF NOT EXISTS database_columns (
    id          TEXT PRIMARY KEY,
    database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'text',
    options     TEXT NOT NULL DEFAULT '[]',
    formula     TEXT NOT NULL DEFAULT '',
    order_index REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_db_columns_database ON database_columns(database_id, order_index);

CREATE TABLE IF NOT EXISTS database_rows (
    id          TEXT PRIMARY KEY,
    database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    order_index REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_db_rows_database ON database_rows(database_id, order_index);

CREATE TABLE IF NOT EXISTS database_cells (
    row_id      TEXT NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
    column_id   TEXT NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (row_id, column_id)
);

CREATE INDEX IF NOT EXISTS idx_db_cells_row ON database_cells(row_id);
