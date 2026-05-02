package handler

import (
	"encoding/json"
	"net/http"
	"noteyard/server/internal/config"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ConfigHandler serves GET /api/config and PUT /api/config.
type ConfigHandler struct {
	cfg          *config.Config
	onDirChange  func(newDir string) error // called when data.dir changes
}

// NewConfigHandler creates a ConfigHandler. onDirChange is invoked when
// a PUT request changes the data directory; it should call MigrateDataDir.
func NewConfigHandler(cfg *config.Config, onDirChange func(newDir string) error) *ConfigHandler {
	return &ConfigHandler{cfg: cfg, onDirChange: onDirChange}
}

type configResponse struct {
	DataDir       string `json:"data_dir"`
	OpsThreshold  int    `json:"ops_threshold"`
	BackupCount   int    `json:"backup_count"`
	LastBackupAt  string `json:"last_backup_at"` // RFC3339 or ""
}

type configUpdateRequest struct {
	DataDir      *string `json:"data_dir"`
	OpsThreshold *int    `json:"ops_threshold"`
}

// Get handles GET /api/config.
func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	backupCount, lastBackup := backupStats(filepath.Join(h.cfg.Data.Dir, "backups"))
	writeJSON(w, http.StatusOK, configResponse{
		DataDir:      h.cfg.Data.Dir,
		OpsThreshold: h.cfg.Backup.OpsThreshold,
		BackupCount:  backupCount,
		LastBackupAt: lastBackup,
	})
}

// Update handles PUT /api/config.
func (h *ConfigHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req configUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Update ops_threshold if provided.
	if req.OpsThreshold != nil {
		if *req.OpsThreshold < 1 || *req.OpsThreshold > 9999 {
			writeError(w, http.StatusBadRequest, "ops_threshold must be between 1 and 9999")
			return
		}
		h.cfg.Backup.OpsThreshold = *req.OpsThreshold
	}

	// Handle data directory change.
	if req.DataDir != nil && *req.DataDir != h.cfg.Data.Dir {
		if err := h.onDirChange(*req.DataDir); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to migrate data directory: "+err.Error())
			return
		}
		// cfg.Data.Dir already updated inside MigrateDataDir.
	}

	// Persist updated config (ops_threshold change).
	if err := config.Write(h.cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write config: "+err.Error())
		return
	}

	backupCount, lastBackup := backupStats(filepath.Join(h.cfg.Data.Dir, "backups"))
	writeJSON(w, http.StatusOK, configResponse{
		DataDir:      h.cfg.Data.Dir,
		OpsThreshold: h.cfg.Backup.OpsThreshold,
		BackupCount:  backupCount,
		LastBackupAt: lastBackup,
	})
}

// backupStats returns the count and RFC3339 timestamp of the most recent
// backup file in backupsDir.
func backupStats(backupsDir string) (count int, lastAt string) {
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		return 0, ""
	}

	var times []time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		count++
		if info, err := e.Info(); err == nil {
			times = append(times, info.ModTime())
		}
	}
	if len(times) == 0 {
		return count, ""
	}
	sort.Slice(times, func(i, j int) bool { return times[i].After(times[j]) })
	return count, times[0].UTC().Format(time.RFC3339)
}
