package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"noteyard/server/internal/model"
	"testing"

	"github.com/go-chi/chi/v5"
)

// mockDatabaseRepo implements repository.DatabaseRepository for testing.
type mockDatabaseRepo struct {
	databases []*model.Database
	rows      []*model.DBRow
	cols      []*model.DBColumn
	forceErr  error
}

func (m *mockDatabaseRepo) Create(_ context.Context, db *model.Database) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	db.ID = "new-db-id"
	m.databases = append(m.databases, db)
	return nil
}

func (m *mockDatabaseRepo) GetByID(_ context.Context, id string) (*model.Database, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	for _, d := range m.databases {
		if d.ID == id {
			return d, nil
		}
	}
	return nil, errors.New("not found")
}

func (m *mockDatabaseRepo) UpdateTitle(_ context.Context, id, title string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for _, d := range m.databases {
		if d.ID == id {
			d.Title = title
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) Delete(_ context.Context, id string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, d := range m.databases {
		if d.ID == id {
			m.databases = append(m.databases[:i], m.databases[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) AddColumn(_ context.Context, col *model.DBColumn) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	col.ID = "new-col-id"
	m.cols = append(m.cols, col)
	return nil
}

func (m *mockDatabaseRepo) UpdateColumn(_ context.Context, col *model.DBColumn) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, c := range m.cols {
		if c.ID == col.ID {
			m.cols[i] = col
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) DeleteColumn(_ context.Context, colID string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, c := range m.cols {
		if c.ID == colID {
			m.cols = append(m.cols[:i], m.cols[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) AddRow(_ context.Context, row *model.DBRow) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	row.ID = "new-row-id"
	m.rows = append(m.rows, row)
	return nil
}

func (m *mockDatabaseRepo) UpdateRow(_ context.Context, row *model.DBRow) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, r := range m.rows {
		if r.ID == row.ID && r.DatabaseID == row.DatabaseID {
			m.rows[i] = row
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) DeleteRow(_ context.Context, rowID string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, r := range m.rows {
		if r.ID == rowID {
			m.rows = append(m.rows[:i], m.rows[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockDatabaseRepo) ListRows(_ context.Context, dbID string) ([]*model.DBRow, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	var out []*model.DBRow
	for _, r := range m.rows {
		if r.DatabaseID == dbID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *mockDatabaseRepo) GetRow(_ context.Context, databaseID, rowID string) (*model.DBRow, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	for _, r := range m.rows {
		if r.ID == rowID && r.DatabaseID == databaseID {
			return r, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (m *mockDatabaseRepo) BatchUpdateCells(_ context.Context, rowID string, cells []*model.DBCell) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	return nil
}

// routeWithDBAndRow builds a chi router injecting {id} and {row_id}.
func routeWithDBAndRow(h http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Get("/{id}/rows/{row_id}", h)
	return r
}

// routeWithDBID builds a chi router injecting {id} for database-level routes.
func routeWithDBID(h http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Post("/{id}", h)
	r.Get("/{id}", h)
	r.Patch("/{id}", h)
	r.Delete("/{id}", h)
	r.Get("/{id}/rows", h)
	r.Post("/{id}/rows", h)
	return r
}

// ---- GetRow tests ----

func TestDatabaseHandler_GetRow_OK(t *testing.T) {
	mock := &mockDatabaseRepo{
		rows: []*model.DBRow{
			{
				ID:         "row-1",
				DatabaseID: "db-1",
				OrderIndex: 1.0,
				Cells:      map[string]string{"col-a": "hello", "col-b": "world"},
			},
		},
	}
	h := NewDatabaseHandler(mock)

	router := routeWithDBAndRow(h.GetRow)
	req := httptest.NewRequest(http.MethodGet, "/db-1/rows/row-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var row model.DBRow
	if err := json.NewDecoder(w.Body).Decode(&row); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if row.ID != "row-1" {
		t.Errorf("ID: got %q, want %q", row.ID, "row-1")
	}
	if row.DatabaseID != "db-1" {
		t.Errorf("DatabaseID: got %q, want %q", row.DatabaseID, "db-1")
	}
	if row.Cells["col-a"] != "hello" {
		t.Errorf("cell col-a: got %q, want %q", row.Cells["col-a"], "hello")
	}
}

func TestDatabaseHandler_GetRow_NotFound(t *testing.T) {
	mock := &mockDatabaseRepo{}
	h := NewDatabaseHandler(mock)

	router := routeWithDBAndRow(h.GetRow)
	req := httptest.NewRequest(http.MethodGet, "/db-1/rows/nonexistent", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestDatabaseHandler_GetRow_WrongDatabase(t *testing.T) {
	mock := &mockDatabaseRepo{
		rows: []*model.DBRow{
			{
				ID:         "row-1",
				DatabaseID: "db-correct",
				OrderIndex: 1.0,
			},
		},
	}
	h := NewDatabaseHandler(mock)

	// Query with a different database ID — databaseID mismatch must return 404.
	router := routeWithDBAndRow(h.GetRow)
	req := httptest.NewRequest(http.MethodGet, "/db-wrong/rows/row-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNotFound)
	}
}

// ---- Regression tests for existing interfaces ----

func TestDatabaseHandler_ListRows(t *testing.T) {
	mock := &mockDatabaseRepo{
		rows: []*model.DBRow{
			{ID: "r1", DatabaseID: "db-x"},
			{ID: "r2", DatabaseID: "db-x"},
		},
	}
	h := NewDatabaseHandler(mock)

	router := routeWithDBID(h.ListRows)
	req := httptest.NewRequest(http.MethodGet, "/db-x/rows", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var rows []*model.DBRow
	json.NewDecoder(w.Body).Decode(&rows)
	if len(rows) != 2 {
		t.Errorf("expected 2 rows, got %d", len(rows))
	}
}

func TestDatabaseHandler_AddRow(t *testing.T) {
	mock := &mockDatabaseRepo{}
	h := NewDatabaseHandler(mock)

	body, _ := json.Marshal(map[string]interface{}{})
	router := routeWithDBID(h.AddRow)
	req := httptest.NewRequest(http.MethodPost, "/db-y/rows", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusCreated)
	}
	var row model.DBRow
	json.NewDecoder(w.Body).Decode(&row)
	if row.DatabaseID != "db-y" {
		t.Errorf("DatabaseID: got %q, want %q", row.DatabaseID, "db-y")
	}
}

func TestDatabaseHandler_DeleteRow(t *testing.T) {
	mock := &mockDatabaseRepo{
		rows: []*model.DBRow{{ID: "row-del", DatabaseID: "db-z"}},
	}
	h := NewDatabaseHandler(mock)

	r := chi.NewRouter()
	r.Delete("/{id}/rows/{row_id}", h.DeleteRow)
	req := httptest.NewRequest(http.MethodDelete, "/db-z/rows/row-del", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestDatabaseHandler_BatchUpdateCells(t *testing.T) {
	mock := &mockDatabaseRepo{}
	h := NewDatabaseHandler(mock)

	cells := []*model.DBCell{{RowID: "row-1", ColumnID: "col-1", Value: "v"}}
	body, _ := json.Marshal(cells)
	r := chi.NewRouter()
	r.Patch("/{id}/rows/{row_id}/cells", h.BatchUpdateCells)
	req := httptest.NewRequest(http.MethodPatch, "/db-1/rows/row-1/cells", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNoContent)
	}
}
