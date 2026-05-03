// Package db provides schema migration utilities for the noteyard database.
package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// Migration represents a single versioned database migration.
// Version numbers start at 1. Version 0 is the implicit initial schema.
type Migration struct {
	Version int
	Up      func(tx *sql.Tx) error
}

// Migrations is the ordered list of schema migrations.
// New migrations must be appended in ascending version order.
var Migrations []Migration

// syncLegacyMigrations checks whether the legacy time-stamp-based `migrations`
// table exists. If it does, it copies the version numbers already recorded
// there into `schema_migrations` so that those schema migrations are not
// re-applied on an upgraded database.
//
// The legacy table stores one row per applied SQL file in ascending order; the
// row's `version` value maps 1:1 to the schema_migrations version number.
// If the table doesn't exist this function is a no-op.
func syncLegacyMigrations(db *sql.DB) error {
	// Check whether the legacy table exists.
	var legacyCount int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='migrations'`,
	).Scan(&legacyCount)
	if err != nil {
		return fmt.Errorf("syncLegacyMigrations: check table: %w", err)
	}
	if legacyCount == 0 {
		return nil // no legacy table — nothing to do
	}

	// Read all versions present in the legacy table.
	rows, err := db.Query(`SELECT version FROM migrations ORDER BY version ASC`)
	if err != nil {
		return fmt.Errorf("syncLegacyMigrations: query legacy: %w", err)
	}
	defer rows.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return fmt.Errorf("syncLegacyMigrations: scan row: %w", err)
		}
		// INSERT OR IGNORE so we never overwrite an existing entry.
		_, err := db.Exec(
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)`,
			version, now,
		)
		if err != nil {
			return fmt.Errorf("syncLegacyMigrations: sync version %d: %w", version, err)
		}
	}
	return rows.Err()
}

// RunMigrations ensures the schema_migrations table exists and then applies
// any pending migrations in version order. If any migration fails the
// transaction is rolled back, the migration is NOT recorded, and an error
// is returned so the caller can abort startup.
func RunMigrations(db *sql.DB) error {
	// Ensure the schema_migrations table exists.
	const createTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);`
	if _, err := db.Exec(createTable); err != nil {
		return fmt.Errorf("schema_migrations: create table: %w", err)
	}

	// Sync legacy migrations table → schema_migrations so that old databases
	// do not re-execute already-applied migrations.
	if err := syncLegacyMigrations(db); err != nil {
		return fmt.Errorf("schema_migrations: sync legacy: %w", err)
	}

	for _, m := range Migrations {
		applied, err := isMigrationApplied(db, m.Version)
		if err != nil {
			return fmt.Errorf("schema_migrations: check version %d: %w", m.Version, err)
		}
		if applied {
			continue
		}

		log.Printf("[migrate] applying schema migration version %d", m.Version)
		if err := applyMigration(db, m); err != nil {
			return fmt.Errorf("schema_migrations: apply version %d: %w", m.Version, err)
		}
		log.Printf("[migrate] schema migration version %d applied", m.Version)
	}
	return nil
}

func isMigrationApplied(db *sql.DB, version int) (bool, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&count)
	return count > 0, err
}

func applyMigration(db *sql.DB, m Migration) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if err = m.Up(tx); err != nil {
		return err
	}

	_, err = tx.Exec(
		`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`,
		m.Version,
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}
