package handler

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// uploadsRefRe matches /uploads/<filename> in cell values and block content.
var uploadsRefRe = regexp.MustCompile(`/uploads/([^"'\s)>]+)`)

// CleanupHandler handles orphan-upload cleanup requests.
type CleanupHandler struct {
	uploadDir string
	db        *sql.DB
}

// NewCleanupHandler constructs a CleanupHandler.
func NewCleanupHandler(uploadDir string, db *sql.DB) *CleanupHandler {
	return &CleanupHandler{uploadDir: uploadDir, db: db}
}

type cleanupResponse struct {
	Deleted int      `json:"deleted"`
	Files   []string `json:"files"`
}

// CleanupOrphanUploads handles POST /api/uploads/cleanup.
// It scans uploadDir, collects all filenames referenced in the DB
// (blocks.content and database_cells.value), then deletes unreferenced files.
func (h *CleanupHandler) CleanupOrphanUploads(w http.ResponseWriter, r *http.Request) {
	// 1. List all files in uploadDir.
	entries, err := os.ReadDir(h.uploadDir)
	if err != nil && !os.IsNotExist(err) {
		writeError(w, http.StatusInternalServerError, "读取上传目录失败: "+err.Error())
		return
	}

	diskFiles := make(map[string]struct{}, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			diskFiles[e.Name()] = struct{}{}
		}
	}

	if len(diskFiles) == 0 {
		writeJSON(w, http.StatusOK, cleanupResponse{Deleted: 0, Files: []string{}})
		return
	}

	// 2. Collect referenced filenames from the database.
	referenced := make(map[string]struct{})

	// 2a. blocks.content
	if err := collectRefsFromColumn(h.db, "SELECT content FROM blocks", referenced); err != nil {
		writeError(w, http.StatusInternalServerError, "查询 blocks 失败: "+err.Error())
		return
	}

	// 2b. database_cells.value
	if err := collectRefsFromColumn(h.db, "SELECT value FROM database_cells", referenced); err != nil {
		writeError(w, http.StatusInternalServerError, "查询 database_cells 失败: "+err.Error())
		return
	}

	// 3. Compute orphans = disk files not referenced in DB.
	var orphans []string
	for name := range diskFiles {
		if _, ok := referenced[name]; !ok {
			orphans = append(orphans, name)
		}
	}

	// 4. Delete orphan files.
	deleted := make([]string, 0, len(orphans))
	for _, name := range orphans {
		path := filepath.Join(h.uploadDir, name)
		if err := os.Remove(path); err == nil {
			deleted = append(deleted, name)
		}
	}

	writeJSON(w, http.StatusOK, cleanupResponse{
		Deleted: len(deleted),
		Files:   deleted,
	})
}

// collectRefsFromColumn runs query (which must select a single TEXT column),
// scans each row for /uploads/<filename> patterns, and adds found filenames
// to the referenced set.
func collectRefsFromColumn(db *sql.DB, query string, referenced map[string]struct{}) error {
	rows, err := db.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var val string
		if err := rows.Scan(&val); err != nil {
			return err
		}
		for _, m := range uploadsRefRe.FindAllStringSubmatch(val, -1) {
			referenced[m[1]] = struct{}{}
		}
	}
	return rows.Err()
}
