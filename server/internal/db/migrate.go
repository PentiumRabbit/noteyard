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
