package handler

import (
	"encoding/json"
	"net/http"
	"noteyard/server/internal/model"
	"noteyard/server/internal/repository"

	"github.com/go-chi/chi/v5"
)

type BlockHandler struct {
	blocks repository.BlockRepository
}

func NewBlockHandler(blocks repository.BlockRepository) *BlockHandler {
	return &BlockHandler{blocks: blocks}
}

func (h *BlockHandler) ListByPage(w http.ResponseWriter, r *http.Request) {
	pageID := chi.URLParam(r, "id")
	blocks, err := h.blocks.ListByPage(r.Context(), pageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if blocks == nil {
		blocks = []*model.Block{}
	}
	writeJSON(w, http.StatusOK, blocks)
}

func (h *BlockHandler) Create(w http.ResponseWriter, r *http.Request) {
	pageID := chi.URLParam(r, "id")
	var block model.Block
	if err := json.NewDecoder(r.Body).Decode(&block); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	block.PageID = pageID
	if err := h.blocks.Create(r.Context(), &block); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, block)
}

func (h *BlockHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var block model.Block
	if err := json.NewDecoder(r.Body).Decode(&block); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	block.ID = id
	if err := h.blocks.Update(r.Context(), &block); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (h *BlockHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.blocks.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *BlockHandler) BatchUpdate(w http.ResponseWriter, r *http.Request) {
	var blocks []*model.Block
	if err := json.NewDecoder(r.Body).Decode(&blocks); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.blocks.BatchUpdate(r.Context(), blocks); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
