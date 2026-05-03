package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// openTestDB opens an in-memory SQLite DB and creates the minimal schema
// required by CleanupHandler (blocks and database_cells tables).
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS pages (
			id TEXT PRIMARY KEY,
			parent_id TEXT,
			title TEXT NOT NULL DEFAULT '',
			icon TEXT,
			cover TEXT,
			order_index REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS blocks (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL,
			parent_block_id TEXT,
			type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '{}',
			content_version INTEGER NOT NULL DEFAULT 0,
			props TEXT NOT NULL DEFAULT '{}',
			order_index REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS databases (
			id TEXT PRIMARY KEY,
			page_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS database_rows (
			id TEXT PRIMARY KEY,
			database_id TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			order_index REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS database_columns (
			id TEXT PRIMARY KEY,
			database_id TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'text',
			options TEXT NOT NULL DEFAULT '[]',
			formula TEXT NOT NULL DEFAULT '',
			is_hidden INTEGER NOT NULL DEFAULT 0,
			order_index REAL NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS database_cells (
			row_id TEXT NOT NULL,
			column_id TEXT NOT NULL,
			value TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (row_id, column_id)
		);
	`)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return db
}

// writeFile creates a file with given name in dir.
func writeFile(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("data"), 0644); err != nil {
		t.Fatalf("writeFile %s: %v", name, err)
	}
}

func TestCleanupOrphanUploads_AllOrphans(t *testing.T) {
	dir := t.TempDir()
	db := openTestDB(t)
	defer db.Close()

	// Put two files on disk, nothing in DB.
	writeFile(t, dir, "abc.png")
	writeFile(t, dir, "def.jpg")

	h := NewCleanupHandler(dir, db)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/cleanup", nil)
	rr := httptest.NewRecorder()
	h.CleanupOrphanUploads(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp cleanupResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Deleted != 2 {
		t.Fatalf("expected 2 deleted, got %d", resp.Deleted)
	}
	// Files must be gone from disk.
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("expected empty dir, got %d entries", len(entries))
	}
}

func TestCleanupOrphanUploads_ReferencedInBlocks(t *testing.T) {
	dir := t.TempDir()
	db := openTestDB(t)
	defer db.Close()

	writeFile(t, dir, "used.png")
	writeFile(t, dir, "orphan.jpg")

	// Reference used.png in a block's content.
	_, err := db.Exec(`INSERT INTO pages(id,title,order_index,created_at,updated_at) VALUES('p1','',0,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO blocks(id,page_id,type,content,content_version,props,order_index,created_at,updated_at)
		 VALUES('b1','p1','image','{"url":"http://localhost:8080/uploads/used.png"}',0,'{}',0,1,1)`)
	if err != nil {
		t.Fatal(err)
	}

	h := NewCleanupHandler(dir, db)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/cleanup", nil)
	rr := httptest.NewRecorder()
	h.CleanupOrphanUploads(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp cleanupResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Deleted != 1 {
		t.Fatalf("expected 1 deleted, got %d", resp.Deleted)
	}
	if resp.Files[0] != "orphan.jpg" {
		t.Fatalf("expected orphan.jpg deleted, got %v", resp.Files)
	}
	// used.png must still exist.
	if _, err := os.Stat(filepath.Join(dir, "used.png")); os.IsNotExist(err) {
		t.Fatal("used.png was incorrectly deleted")
	}
}

func TestCleanupOrphanUploads_ReferencedInCells(t *testing.T) {
	dir := t.TempDir()
	db := openTestDB(t)
	defer db.Close()

	writeFile(t, dir, "cell-ref.pdf")
	writeFile(t, dir, "ghost.png")

	// Reference cell-ref.pdf in a database_cells value.
	_, err := db.Exec(
		`INSERT INTO database_cells(row_id,column_id,value,updated_at)
		 VALUES('r1','c1','http://localhost:8080/uploads/cell-ref.pdf',1)`)
	if err != nil {
		t.Fatal(err)
	}

	h := NewCleanupHandler(dir, db)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/cleanup", nil)
	rr := httptest.NewRecorder()
	h.CleanupOrphanUploads(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp cleanupResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Deleted != 1 {
		t.Fatalf("expected 1 deleted, got %d", resp.Deleted)
	}
	if resp.Files[0] != "ghost.png" {
		t.Fatalf("expected ghost.png deleted, got %v", resp.Files)
	}
}

func TestCleanupOrphanUploads_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	db := openTestDB(t)
	defer db.Close()

	h := NewCleanupHandler(dir, db)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/cleanup", nil)
	rr := httptest.NewRecorder()
	h.CleanupOrphanUploads(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp cleanupResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Deleted != 0 {
		t.Fatalf("expected 0 deleted, got %d", resp.Deleted)
	}
}

func TestCleanupOrphanUploads_NoneOrphaned(t *testing.T) {
	dir := t.TempDir()
	db := openTestDB(t)
	defer db.Close()

	writeFile(t, dir, "keep.png")

	_, err := db.Exec(`INSERT INTO pages(id,title,order_index,created_at,updated_at) VALUES('p1','',0,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO blocks(id,page_id,type,content,content_version,props,order_index,created_at,updated_at)
		 VALUES('b1','p1','image','{"url":"/uploads/keep.png"}',0,'{}',0,1,1)`)
	if err != nil {
		t.Fatal(err)
	}

	h := NewCleanupHandler(dir, db)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/cleanup", nil)
	rr := httptest.NewRecorder()
	h.CleanupOrphanUploads(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp cleanupResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Deleted != 0 {
		t.Fatalf("expected 0 deleted, got %d", resp.Deleted)
	}
	// keep.png must still be on disk.
	if _, err := os.Stat(filepath.Join(dir, "keep.png")); os.IsNotExist(err) {
		t.Fatal("keep.png was incorrectly deleted")
	}
}
