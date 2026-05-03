// Package backup provides functionality to create .db file backups of the
// noteyard SQLite database.
package backup

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync/atomic"
	"time"
)

// Manager tracks write operation counts and triggers backups automatically.
type Manager struct {
	dbPath     string        // absolute path to noteyard.db
	backupsDir func() string // resolved at call time (data dir may change)
	threshold  func() int    // current ops_threshold from config
	maxBackups func() int    // current max_backups from config (0 = unlimited)
	opsCount   atomic.Int64
	running    atomic.Bool
}

// NewManager creates a Manager. backupsDirFn, thresholdFn, and maxBackupsFn are
// called each time a backup decision is made so they always reflect the latest config.
func NewManager(dbPath string, backupsDirFn func() string, thresholdFn func() int, maxBackupsFn func() int) *Manager {
	return &Manager{
		dbPath:     dbPath,
		backupsDir: backupsDirFn,
		threshold:  thresholdFn,
		maxBackups: maxBackupsFn,
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
		dir := m.backupsDir()
		if err := Backup(m.dbPath, dir); err != nil {
			log.Printf("[backup] exit backup failed: %v", err)
			return
		}
		if max := m.maxBackups(); max > 0 {
			if err := PruneOldBackups(dir, max); err != nil {
				log.Printf("[backup] prune failed: %v", err)
			}
		}
	}
}

func (m *Manager) triggerAsync() {
	if !m.running.CompareAndSwap(false, true) {
		return
	}
	defer m.running.Store(false)
	dir := m.backupsDir()
	if err := Backup(m.dbPath, dir); err != nil {
		log.Printf("[backup] async backup failed: %v", err)
		return
	}
	if max := m.maxBackups(); max > 0 {
		if err := PruneOldBackups(dir, max); err != nil {
			log.Printf("[backup] prune failed: %v", err)
		}
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

// PruneOldBackups deletes the oldest .db backup files in backupsDir so that
// at most maxKeep files remain. Files are ordered by modification time;
// the newest maxKeep are kept and the rest are deleted.
// It is a no-op when maxKeep <= 0.
func PruneOldBackups(backupsDir string, maxKeep int) error {
	if maxKeep <= 0 {
		return nil
	}

	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("backup: prune readdir %s: %w", backupsDir, err)
	}

	type fileInfo struct {
		path    string
		modTime time.Time
	}

	var files []fileInfo
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".db" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fileInfo{
			path:    filepath.Join(backupsDir, e.Name()),
			modTime: info.ModTime(),
		})
	}

	if len(files) <= maxKeep {
		return nil
	}

	// Sort newest first.
	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.After(files[j].modTime)
	})

	// Delete everything beyond maxKeep.
	for _, f := range files[maxKeep:] {
		if err := os.Remove(f.path); err != nil && !os.IsNotExist(err) {
			log.Printf("[backup] prune: failed to delete %s: %v", f.path, err)
		} else {
			log.Printf("[backup] prune: deleted %s", f.path)
		}
	}
	return nil
}
