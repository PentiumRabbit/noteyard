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

var allowedTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

type UploadHandler struct {
	uploadDir string
	baseURL   string
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

	buf := make([]byte, 512)
	if _, err := file.Read(buf); err != nil {
		writeError(w, http.StatusInternalServerError, "读取文件失败")
		return
	}
	mimeType := http.DetectContentType(buf)
	// 去掉参数部分（如 "image/jpeg; charset=..."）
	mimeType = strings.Split(mimeType, ";")[0]
	mimeType = strings.TrimSpace(mimeType)

	ext, ok := allowedTypes[mimeType]
	if !ok {
		// 回退到文件名扩展名校验
		nameExt := strings.ToLower(filepath.Ext(header.Filename))
		for _, v := range allowedTypes {
			if v == nameExt {
				ext = nameExt
				ok = true
				break
			}
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "不支持的图片格式，仅支持 jpg/png/gif/webp")
			return
		}
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

	// 先写已读的 buf，再 copy 剩余
	if _, err := dst.Write(buf); err != nil {
		writeError(w, http.StatusInternalServerError, "写入文件失败")
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "写入文件失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"url": h.baseURL + "/uploads/" + filename,
	})
}
