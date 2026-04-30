package handler

import (
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"

	"github.com/go-chi/chi/v5"
)

type DatabaseHandler struct {
	db repository.DatabaseRepository
}

func NewDatabaseHandler(db repository.DatabaseRepository) *DatabaseHandler {
	return &DatabaseHandler{db: db}
}

func (h *DatabaseHandler) Create(w http.ResponseWriter, r *http.Request) {
	var d model.Database
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.db.Create(r.Context(), &d); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (h *DatabaseHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	d, err := h.db.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "database not found")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *DatabaseHandler) UpdateTitle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.db.UpdateTitle(r.Context(), id, body.Title); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) AddColumn(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var col model.DBColumn
	if err := json.NewDecoder(r.Body).Decode(&col); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	col.DatabaseID = id
	if err := h.db.AddColumn(r.Context(), &col); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, col)
}

func (h *DatabaseHandler) UpdateColumn(w http.ResponseWriter, r *http.Request) {
	colID := chi.URLParam(r, "col_id")
	var col model.DBColumn
	if err := json.NewDecoder(r.Body).Decode(&col); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	col.ID = colID
	col.DatabaseID = chi.URLParam(r, "id")
	if err := h.db.UpdateColumn(r.Context(), &col); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (h *DatabaseHandler) DeleteColumn(w http.ResponseWriter, r *http.Request) {
	colID := chi.URLParam(r, "col_id")
	if err := h.db.DeleteColumn(r.Context(), colID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) AddRow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var row model.DBRow
	if err := json.NewDecoder(r.Body).Decode(&row); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	row.DatabaseID = id
	if err := h.db.AddRow(r.Context(), &row); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (h *DatabaseHandler) DeleteRow(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "row_id")
	if err := h.db.DeleteRow(r.Context(), rowID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) ListRows(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.db.ListRows(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []*model.DBRow{}
	}

	q := r.URL.Query()
	sortCol := q.Get("sort_col")
	sortOrder := q.Get("sort_order") // "asc" | "desc"
	filterCol := q.Get("filter_col")
	filterOp := q.Get("filter_op")   // "contains" | "equals" | "not_equals" | "is_empty" | "is_not_empty" | "gt" | "lt"
	filterVal := q.Get("filter_val")

	if filterCol != "" {
		rows = applyFilter(rows, filterCol, filterOp, filterVal)
	}
	if sortCol != "" {
		applySort(rows, sortCol, sortOrder)
	}

	writeJSON(w, http.StatusOK, rows)
}

func (h *DatabaseHandler) BatchUpdateCells(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "row_id")
	var cells []*model.DBCell
	if err := json.NewDecoder(r.Body).Decode(&cells); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.db.BatchUpdateCells(r.Context(), rowID, cells); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
