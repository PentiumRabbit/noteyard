package handler

import (
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"

	"github.com/go-chi/chi/v5"
)

type PageHandler struct {
	pages repository.PageRepository
}

func NewPageHandler(pages repository.PageRepository) *PageHandler {
	return &PageHandler{pages: pages}
}

func (h *PageHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	pages, err := h.pages.ListAll(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pages == nil {
		pages = []*model.Page{}
	}
	writeJSON(w, http.StatusOK, pages)
}

func (h *PageHandler) Create(w http.ResponseWriter, r *http.Request) {
	var page model.Page
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if page.Title == "" {
		page.Title = "Untitled"
	}
	if err := h.pages.Create(r.Context(), &page); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, page)
}

func (h *PageHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	page, err := h.pages.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *PageHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var page model.Page
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	page.ID = id
	if err := h.pages.Update(r.Context(), &page); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *PageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.pages.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
