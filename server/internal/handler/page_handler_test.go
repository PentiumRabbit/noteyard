package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"noteyard/server/internal/model"
	"testing"

	"github.com/go-chi/chi/v5"
)

// mockPageRepo implements repository.PageRepository for testing.
type mockPageRepo struct {
	pages    []*model.Page
	trashed  []*model.Page
	forceErr error
}

func (m *mockPageRepo) GetByID(_ context.Context, id string) (*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	for _, p := range m.pages {
		if p.ID == id {
			return p, nil
		}
	}
	return nil, errors.New("not found")
}

func (m *mockPageRepo) ListChildren(_ context.Context, _ string) ([]*model.Page, error) {
	return nil, nil
}

func (m *mockPageRepo) ListAll(_ context.Context) ([]*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	return m.pages, nil
}

func (m *mockPageRepo) ListTrashed(_ context.Context) ([]*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	return m.trashed, nil
}

func (m *mockPageRepo) GetAncestors(_ context.Context, _ string) ([]*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	return []*model.Page{}, nil
}

func (m *mockPageRepo) Create(_ context.Context, page *model.Page) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	page.ID = "new-id"
	m.pages = append(m.pages, page)
	return nil
}

func (m *mockPageRepo) Update(_ context.Context, page *model.Page) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, p := range m.pages {
		if p.ID == page.ID {
			m.pages[i] = page
			return nil
		}
	}
	return nil
}

func (m *mockPageRepo) SoftDelete(_ context.Context, id string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, p := range m.pages {
		if p.ID == id {
			m.trashed = append(m.trashed, p)
			m.pages = append(m.pages[:i], m.pages[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockPageRepo) Restore(_ context.Context, id string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, p := range m.trashed {
		if p.ID == id {
			m.pages = append(m.pages, p)
			m.trashed = append(m.trashed[:i], m.trashed[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockPageRepo) PermanentDelete(_ context.Context, id string) error {
	if m.forceErr != nil {
		return m.forceErr
	}
	for i, p := range m.trashed {
		if p.ID == id {
			m.trashed = append(m.trashed[:i], m.trashed[i+1:]...)
			return nil
		}
	}
	return nil
}

func (m *mockPageRepo) Move(_ context.Context, _, _ string, _ float64) error {
	return m.forceErr
}

func (m *mockPageRepo) Search(_ context.Context, q string) ([]*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	var out []*model.Page
	for _, p := range m.pages {
		if len(q) > 0 && len(p.Title) > 0 && contains(p.Title, q) {
			out = append(out, p)
		}
	}
	return out, nil
}

func (m *mockPageRepo) Backlinks(_ context.Context, id string) ([]*model.Page, error) {
	if m.forceErr != nil {
		return nil, m.forceErr
	}
	_ = id
	return []*model.Page{}, nil
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && (s[:len(sub)] == sub || contains(s[1:], sub)))
}

// routeWithID builds a chi router that injects {id} and calls the given handler.
func routeWithID(h http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Get("/{id}", h)
	r.Put("/{id}", h)
	r.Delete("/{id}", h)
	r.Post("/{id}/restore", h)
	r.Delete("/{id}/permanent", h)
	r.Get("/{id}/ancestors", h)
	r.Get("/{id}/backlinks", h)
	return r
}

func TestPageHandler_ListAll(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{
		{ID: "1", Title: "A"},
		{ID: "2", Title: "B"},
	}}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ListAll(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var pages []*model.Page
	json.NewDecoder(w.Body).Decode(&pages)
	if len(pages) != 2 {
		t.Errorf("expected 2 pages, got %d", len(pages))
	}
}

func TestPageHandler_ListAll_Empty(t *testing.T) {
	mock := &mockPageRepo{}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ListAll(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var pages []*model.Page
	json.NewDecoder(w.Body).Decode(&pages)
	if pages == nil || len(pages) != 0 {
		t.Errorf("expected empty array, got %v", pages)
	}
}

func TestPageHandler_ListAll_Error(t *testing.T) {
	mock := &mockPageRepo{forceErr: errors.New("db error")}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ListAll(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestPageHandler_Create(t *testing.T) {
	mock := &mockPageRepo{}
	h := NewPageHandler(mock)

	body, _ := json.Marshal(map[string]string{"title": "New Page"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusCreated)
	}
	var page model.Page
	json.NewDecoder(w.Body).Decode(&page)
	if page.Title != "New Page" {
		t.Errorf("Title: got %q, want %q", page.Title, "New Page")
	}
}

func TestPageHandler_Create_EmptyTitle_DefaultsToUntitled(t *testing.T) {
	mock := &mockPageRepo{}
	h := NewPageHandler(mock)

	body, _ := json.Marshal(map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusCreated)
	}
	var page model.Page
	json.NewDecoder(w.Body).Decode(&page)
	if page.Title != "Untitled" {
		t.Errorf("Title: got %q, want 'Untitled'", page.Title)
	}
}

func TestPageHandler_Create_InvalidBody(t *testing.T) {
	mock := &mockPageRepo{}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("not json"))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPageHandler_Get(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{{ID: "abc", Title: "Found"}}}
	h := NewPageHandler(mock)

	router := routeWithID(h.Get)
	req := httptest.NewRequest(http.MethodGet, "/abc", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var page model.Page
	json.NewDecoder(w.Body).Decode(&page)
	if page.Title != "Found" {
		t.Errorf("Title: got %q", page.Title)
	}
}

func TestPageHandler_Get_NotFound(t *testing.T) {
	mock := &mockPageRepo{}
	h := NewPageHandler(mock)

	router := routeWithID(h.Get)
	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestPageHandler_Delete(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{{ID: "del-me", Title: "To Delete"}}}
	h := NewPageHandler(mock)

	router := routeWithID(h.Delete)
	req := httptest.NewRequest(http.MethodDelete, "/del-me", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestPageHandler_Search(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{
		{ID: "1", Title: "Go Guide"},
		{ID: "2", Title: "Python Notes"},
	}}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/search?q=Go", nil)
	w := httptest.NewRecorder()
	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var pages []*model.Page
	json.NewDecoder(w.Body).Decode(&pages)
	if len(pages) != 1 {
		t.Errorf("expected 1 search result, got %d", len(pages))
	}
}

func TestPageHandler_Search_EmptyQuery(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{{ID: "1", Title: "X"}}}
	h := NewPageHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/search?q=", nil)
	w := httptest.NewRecorder()
	h.Search(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var pages []*model.Page
	json.NewDecoder(w.Body).Decode(&pages)
	if len(pages) != 0 {
		t.Errorf("empty query should return empty array, got %d", len(pages))
	}
}

func TestPageHandler_Backlinks(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{{ID: "target", Title: "T"}}}
	h := NewPageHandler(mock)

	router := routeWithID(h.Backlinks)
	req := httptest.NewRequest(http.MethodGet, "/target/backlinks", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
}

func TestPageHandler_GetAncestors(t *testing.T) {
	mock := &mockPageRepo{pages: []*model.Page{{ID: "child", Title: "Child"}}}
	h := NewPageHandler(mock)

	router := routeWithID(h.GetAncestors)
	req := httptest.NewRequest(http.MethodGet, "/child/ancestors", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
}
