package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed *.sql
var migrationFS embed.FS

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
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
