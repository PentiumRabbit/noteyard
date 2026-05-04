package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
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

func (h *DatabaseHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	dbs, err := h.db.ListAll(r.Context())
	if err != nil {
		writeInternalError(w, r, err)
		return
	}
	if dbs == nil {
		dbs = []*model.DatabaseSummary{}
	}
	writeJSON(w, http.StatusOK, dbs)
}

func (h *DatabaseHandler) Create(w http.ResponseWriter, r *http.Request) {
	var d model.Database
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.db.Create(r.Context(), &d); err != nil {
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (h *DatabaseHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	d, err := h.db.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeInternalError(w, r, err)
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
		writeInternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.Delete(r.Context(), id); err != nil {
		writeInternalError(w, r, err)
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
		writeInternalError(w, r, err)
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
		writeInternalError(w, r, err)
		return
	}
	if row.Cells == nil {
		row.Cells = map[string]string{}
	}
	writeJSON(w, http.StatusCreated, row)
}

func (h *DatabaseHandler) DeleteRow(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "row_id")
	if err := h.db.DeleteRow(r.Context(), rowID); err != nil {
		writeInternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DatabaseHandler) ListRows(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.db.ListRows(r.Context(), id)
	if err != nil {
		writeInternalError(w, r, err)
		return
	}
	if rows == nil {
		rows = []*model.DBRow{}
	}

	sortCol, sortOrder, filterCol, filterOp, filterVal := ParseSortFilter(r)

	if filterCol != "" {
		rows = applyFilter(rows, filterCol, filterOp, filterVal)
	}
	if sortCol != "" {
		applySort(rows, sortCol, sortOrder)
	}

	writeJSON(w, http.StatusOK, rows)
}

func (h *DatabaseHandler) GetRow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rowID := chi.URLParam(r, "row_id")
	row, err := h.db.GetRow(r.Context(), id, rowID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (h *DatabaseHandler) PatchRow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rowID := chi.URLParam(r, "row_id")
	var body struct {
		Content *string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	row, err := h.db.GetRow(r.Context(), id, rowID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeInternalError(w, r, err)
		return
	}
	if body.Content != nil {
		row.Content = *body.Content
	}
	if err := h.db.UpdateRow(r.Context(), row); err != nil {
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (h *DatabaseHandler) ReorderRows(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(body.Order) == 0 {
		writeError(w, http.StatusBadRequest, "order must not be empty")
		return
	}
	if err := h.db.ReorderRows(r.Context(), id, body.Order); err != nil {
		writeInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

func (h *DatabaseHandler) BatchUpdateCells(w http.ResponseWriter, r *http.Request) {
	rowID := chi.URLParam(r, "row_id")
	var cells []*model.DBCell
	if err := json.NewDecoder(r.Body).Decode(&cells); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.db.BatchUpdateCells(r.Context(), rowID, cells); err != nil {
		writeInternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
