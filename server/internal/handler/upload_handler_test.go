package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func newUploadRequest(t *testing.T, filename string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(content)
	w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/uploads", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func TestUpload_PNG(t *testing.T) {
	dir := t.TempDir()
	h := NewUploadHandler(dir, "http://localhost:8080")

	// 最小合法 PNG（8 字节签名 + 空）
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	req := newUploadRequest(t, "test.png", pngHeader)
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp uploadResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.URL == "" {
		t.Fatal("response missing url field")
	}
	if resp.Name != "test.png" {
		t.Fatalf("expected name=test.png, got %s", resp.Name)
	}
	if resp.MIME != "image/png" {
		t.Fatalf("expected mime=image/png, got %s", resp.MIME)
	}
	if resp.Size <= 0 {
		t.Fatalf("expected size > 0, got %d", resp.Size)
	}
	// 验证文件确实写入了磁盘
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("expected 1 file in upload dir, got %d", len(entries))
	}
	if filepath.Ext(entries[0].Name()) != ".png" {
		t.Fatalf("expected .png extension, got %s", entries[0].Name())
	}
}

func TestUpload_InvalidFormat(t *testing.T) {
	dir := t.TempDir()
	h := NewUploadHandler(dir, "http://localhost:8080")

	// .exe is not in the allowlist — must return 400
	req := newUploadRequest(t, "malware.exe", []byte("MZ\x90\x00"))
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestUpload_MissingFile(t *testing.T) {
	dir := t.TempDir()
	h := NewUploadHandler(dir, "http://localhost:8080")

	req := httptest.NewRequest(http.MethodPost, "/api/uploads", bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=xxx")
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestUpload_JPEG(t *testing.T) {
	dir := t.TempDir()
	h := NewUploadHandler(dir, "http://localhost:8080")

	// JPEG magic bytes
	jpegHeader := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46}
	req := newUploadRequest(t, "photo.jpg", jpegHeader)
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestUpload_URLFormat(t *testing.T) {
	dir := t.TempDir()
	h := NewUploadHandler(dir, "http://localhost:8080")

	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	req := newUploadRequest(t, "test.png", pngHeader)
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	var resp uploadResponse
	json.NewDecoder(rr.Body).Decode(&resp)
	url := resp.URL
	if len(url) < len("http://localhost:8080/uploads/") {
		t.Fatalf("url too short: %s", url)
	}
	if url[:len("http://localhost:8080/uploads/")] != "http://localhost:8080/uploads/" {
		t.Fatalf("url prefix wrong: %s", url)
	}
}
