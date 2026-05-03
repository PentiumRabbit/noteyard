package db

import (
	"database/sql"
	"fmt"
)

// CurrentContentVersion is the latest BlockNote JSON format version the server
// natively produces. Bump this constant when a new format is introduced.
const CurrentContentVersion = 1

// ContentMigrateFn transforms note content from version (key-1) to version
// (key). For example, the entry at key 2 upgrades content from v1 → v2.
type ContentMigrateFn func(content string) (string, error)

// contentMigrations maps target version to the upgrade function.
// The entry at key N upgrades content stored at version N-1 to version N.
// Leave this map empty until a second format version is needed.
var contentMigrations = map[int]ContentMigrateFn{
	// Example future entry:
	// 2: func(s string) (string, error) { return migrateV1toV2(s) },
}

// MigrateContent walks the version chain from fromVersion up to
// CurrentContentVersion, applying each registered conversion function.
// If fromVersion == CurrentContentVersion the content is returned unchanged.
// Gaps in the contentMigrations map are treated as no-ops (identity).
func MigrateContent(content string, fromVersion int) (string, int, error) {
	current := content
	for v := fromVersion + 1; v <= CurrentContentVersion; v++ {
		fn, ok := contentMigrations[v]
		if !ok {
			// No-op: version transition has no registered converter yet.
			continue
		}
		var err error
		current, err = fn(current)
		if err != nil {
			return "", fromVersion, fmt.Errorf("content migration v%d→v%d: %w", v-1, v, err)
		}
	}
	return current, CurrentContentVersion, nil
}

// ContentVersionMigration is the schema migration that adds the
// content_version column to the notes table. Register it in migrate.go's
// Migrations slice via init().
func ContentVersionMigration(tx *sql.Tx) error {
	// Use a no-op if the column already exists (idempotent for upgraded databases).
	var count int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('blocks') WHERE name='content_version'`,
	).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := tx.Exec(
		`ALTER TABLE blocks ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1`,
	)
	return err
}

func init() {
	Migrations = append(Migrations, Migration{
		Version: 8, // versions 1-7 are reserved for legacy SQL file migrations
		Up:      ContentVersionMigration,
	})
}
