package config

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

// MigrateDataDir moves the database file and backups/ subdirectory from
// oldDir to newDir, then updates cfg.Data.Dir and persists the config.
//
// Strategy:
//  1. Create newDir (and newDir/backups/) if they don't exist.
//  2. Copy / rename noteyard.db to newDir.
//  3. Copy / move contents of oldDir/backups/ to newDir/backups/.
//  4. On any error: remove anything already copied to newDir, return error.
//  5. On success: remove originals and update cfg.
func MigrateDataDir(cfg *Config, newDir string) error {
	oldDir := cfg.Data.Dir
	if oldDir == newDir {
		return nil
	}

	newBackupsDir := filepath.Join(newDir, "backups")
	oldBackupsDir := filepath.Join(oldDir, "backups")

	// Create destination directories.
	if err := os.MkdirAll(newBackupsDir, 0755); err != nil {
		return fmt.Errorf("migrate_dir: mkdir %s: %w", newBackupsDir, err)
	}

	oldDB := filepath.Join(oldDir, "noteyard.db")
	newDB := filepath.Join(newDir, "noteyard.db")

	// Move database file.
	if err := moveFile(oldDB, newDB); err != nil {
		// Rollback: remove anything we may have put in newDir.
		rollback(newDir, oldDir, newDB, oldDB)
		return fmt.Errorf("migrate_dir: move db: %w", err)
	}

	// Move backups/ directory contents.
	if err := moveDir(oldBackupsDir, newBackupsDir); err != nil {
		rollback(newDir, oldDir, newDB, oldDB)
		return fmt.Errorf("migrate_dir: move backups: %w", err)
	}

	// Remove old backups dir if now empty.
	_ = os.Remove(oldBackupsDir)

	// Persist updated config.
	cfg.Data.Dir = newDir
	if err := Write(cfg); err != nil {
		// Non-fatal: in-memory cfg is already updated; log and continue.
		log.Printf("[config] migrate_dir: could not write updated config: %v", err)
	}
	return nil
}

// moveFile attempts os.Rename first (atomic on same filesystem).
// Falls back to copy+delete on cross-device moves.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// Fallback: copy then delete.
	return copyThenDelete(src, dst)
}

func copyThenDelete(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}

	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return err
	}
	return os.Remove(src)
}

// moveDir copies all files from srcDir to dstDir (non-recursive, flat).
// dstDir must already exist.
func moveDir(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if os.IsNotExist(err) {
		return nil // no backups yet; nothing to migrate
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue // skip nested directories
		}
		src := filepath.Join(srcDir, entry.Name())
		dst := filepath.Join(dstDir, entry.Name())
		if err := moveFile(src, dst); err != nil {
			return fmt.Errorf("migrate_dir: move %s: %w", entry.Name(), err)
		}
	}
	return nil
}

// rollback attempts to move the db file back to oldDir on failure.
func rollback(newDir, oldDir, newDB, oldDB string) {
	if _, err := os.Stat(newDB); err == nil {
		if mvErr := moveFile(newDB, oldDB); mvErr != nil {
			log.Printf("[config] migrate_dir rollback failed for db: %v", mvErr)
		}
	}
	// Best-effort: remove newly created directory if empty.
	_ = os.Remove(filepath.Join(newDir, "backups"))
	_ = os.Remove(newDir)
}
