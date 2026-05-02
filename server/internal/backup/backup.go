// Package backup provides functionality to create .db file backups of the
// noteyard SQLite database.
package backup

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// Manager tracks write operation counts and triggers backups automatically.
type Manager struct {
	dbPath     string        // absolute path to noteyard.db
	backupsDir func() string // resolved at call time (data dir may change)
	threshold  func() int    // current ops_threshold from config
	opsCount   atomic.Int64
}

// NewManager creates a Manager. backupsDirFn and thresholdFn are called
// each time a backup decision is made so they always reflect the latest config.
func NewManager(dbPath string, backupsDirFn func() string, thresholdFn func() int) *Manager {
	return &Manager{
		dbPath:     dbPath,
		backupsDir: backupsDirFn,
		threshold:  thresholdFn,
	}
}

// RecordWrite increments the write-operation counter. When the counter reaches
// the configured threshold a backup is triggered asynchronously and the counter
// resets to zero.
func (m *Manager) RecordWrite() {
	n := m.opsCount.Add(1)
	if int(n) >= m.threshold() {
		m.opsCount.Store(0)
		go m.triggerAsync()
	}
}

// OnExit should be called when the application is shutting down. It triggers a
// synchronous backup if any writes have occurred since the last backup.
func (m *Manager) OnExit() {
	if m.opsCount.Load() > 0 {
		if err := Backup(m.dbPath, m.backupsDir()); err != nil {
			log.Printf("[backup] exit backup failed: %v", err)
		}
	}
}

func (m *Manager) triggerAsync() {
	if err := Backup(m.dbPath, m.backupsDir()); err != nil {
		log.Printf("[backup] async backup failed: %v", err)
	}
}

// Backup copies dbPath into backupsDir with a timestamped filename.
// backupsDir is created if it does not exist.
// The backup is written to a temp file first and renamed to prevent partial
// copies from appearing as valid backup files.
func Backup(dbPath, backupsDir string) error {
	if err := os.MkdirAll(backupsDir, 0755); err != nil {
		return fmt.Errorf("backup: mkdir %s: %w", backupsDir, err)
	}

	ts := time.Now().Format("2006-01-02T15-04-05")
	destName := fmt.Sprintf("noteyard-backup-%s.db", ts)
	destPath := filepath.Join(backupsDir, destName)
	tmpPath := destPath + ".tmp"

	src, err := os.Open(dbPath)
	if err != nil {
		return fmt.Errorf("backup: open source: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("backup: create tmp: %w", err)
	}

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("backup: copy: %w", err)
	}
	if err := dst.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("backup: close tmp: %w", err)
	}

	if err := os.Rename(tmpPath, destPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("backup: rename: %w", err)
	}

	log.Printf("[backup] created %s", destPath)
	return nil
}
