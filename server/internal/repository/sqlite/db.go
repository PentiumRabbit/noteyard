package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"log/slog"
	appdb "noteyard/server/internal/db"
	"noteyard/server/internal/db/seeds"
	"sort"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed *.sql
var migrationFS embed.FS

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_foreign_keys=on&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
	}
	// Run schema_migrations framework (content_version, future versioned changes).
	if err := appdb.RunMigrations(db); err != nil {
		return nil, fmt.Errorf("schema migration: %w", err)
	}

	// REQ-078: restore welcome page blocks if the user deleted all of them.
	welcomePage, welcomeBlocks, err := seeds.ParseSeed(seeds.WelcomeJSON)
	if err != nil {
		return nil, fmt.Errorf("parse welcome seed: %w", err)
	}
	if err := seeds.RestoreWelcomeIfEmpty(db, welcomePage, welcomeBlocks); err != nil {
		// Non-fatal: log and continue rather than refusing to start.
		slog.Warn("RestoreWelcomeIfEmpty failed", "err", err)
	}

	return db, nil
}

func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	entries, err := migrationFS.ReadDir(".")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for i, entry := range entries {
		version := i + 1
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM migrations WHERE version = ?`, version).Scan(&count)
		if count > 0 {
			continue
		}
		data, err := migrationFS.ReadFile(entry.Name())
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(data)); err != nil {
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		db.Exec(`INSERT INTO migrations(version, applied_at) VALUES(?, ?)`, version, time.Now().Unix())
	}
	return nil
}
