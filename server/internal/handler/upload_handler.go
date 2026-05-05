package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const maxUploadSize = 100 << 20 // 100MB

type UploadHandler struct {
	uploadDir string
}

type uploadResponse struct {
	URL  string `json:"url"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	MIME string `json:"mime"`
}

func NewUploadHandler(uploadDir string) *UploadHandler {
	return &UploadHandler{uploadDir: uploadDir}
}

func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "文件超过 100MB 限制")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".bin"
	}
	mime := strings.TrimSpace(strings.Split(header.Header.Get("Content-Type"), ";")[0])
	if mime == "" {
		mime = "application/octet-stream"
	}

	if err := os.MkdirAll(h.uploadDir, 0755); err != nil {
		writeInternalError(w, r, err)
		return
	}

	filename := fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), uuid.New().String()[:8], ext)
	dst, err := os.Create(filepath.Join(h.uploadDir, filename))
	if err != nil {
		writeInternalError(w, r, err)
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, uploadResponse{
		URL:  "/uploads/" + filename,
		Name: header.Filename,
		Size: written,
		MIME: mime,
	})
}
