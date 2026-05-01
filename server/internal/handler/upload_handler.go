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

const maxUploadSize = 10 << 20 // 10MB

// mimeToExt maps validated MIME types to their canonical file extensions.
// Images are detected via http.DetectContentType (byte-header based).
// Non-image types (PDF, docx, etc.) are matched by extension whitelist because
// http.DetectContentType returns "application/octet-stream" for them.
var mimeToExt = map[string]string{
	// images — byte-header detection reliable
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
	// documents — extension-whitelist primary path
	"application/pdf": ".pdf",
	"application/msword":                                                 ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
	"text/plain":    ".txt",
	"text/markdown": ".md",
	"application/zip": ".zip",
}

// extToMime maps lower-case file extensions to their canonical MIME types.
var extToMime = func() map[string]string {
	m := make(map[string]string, len(mimeToExt))
	for mime, ext := range mimeToExt {
		m[ext] = mime
	}
	return m
}()

// imageMIMEs is the set of MIME types that http.DetectContentType handles reliably.
var imageMIMEs = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

type UploadHandler struct {
	uploadDir string
	baseURL   string
}

type uploadResponse struct {
	URL  string `json:"url"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	MIME string `json:"mime"`
}

func NewUploadHandler(uploadDir, baseURL string) *UploadHandler {
	return &UploadHandler{uploadDir: uploadDir, baseURL: baseURL}
}

func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "文件超过 10MB 限制")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少 file 字段")
		return
	}
	defer file.Close()

	// Read first 512 bytes for content-type sniffing.
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		writeError(w, http.StatusInternalServerError, "读取文件失败")
		return
	}
	buf = buf[:n]

	detectedMIME := strings.TrimSpace(strings.Split(http.DetectContentType(buf), ";")[0])
	nameExt := strings.ToLower(filepath.Ext(header.Filename))

	var (
		finalMIME string
		ext       string
		ok        bool
	)

	if imageMIMEs[detectedMIME] {
		// Image path: trust byte-header detection.
		ext, ok = mimeToExt[detectedMIME]
		if ok {
			finalMIME = detectedMIME
		}
	}

	if !ok {
		// Non-image (or unrecognised image) path: trust extension whitelist.
		finalMIME, ok = extToMime[nameExt]
		if ok {
			ext = nameExt
		}
	}

	if !ok {
		writeError(w, http.StatusBadRequest, "不支持的文件格式，仅支持 jpg/png/gif/webp/pdf/doc/docx/txt/md/zip")
		return
	}

	if err := os.MkdirAll(h.uploadDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "创建上传目录失败")
		return
	}

	filename := fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), uuid.New().String()[:8], ext)
	dst, err := os.Create(filepath.Join(h.uploadDir, filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建文件失败")
		return
	}
	defer dst.Close()

	// Write already-read bytes first, then copy the remainder.
	if _, err := dst.Write(buf); err != nil {
		writeError(w, http.StatusInternalServerError, "写入文件失败")
		return
	}
	written, err := io.Copy(dst, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "写入文件失败")
		return
	}

	writeJSON(w, http.StatusOK, uploadResponse{
		URL:  h.baseURL + "/uploads/" + filename,
		Name: header.Filename,
		Size: int64(n) + written,
		MIME: finalMIME,
	})
}
