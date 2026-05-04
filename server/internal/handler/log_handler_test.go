package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func postLog(t *testing.T, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/log", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	LogHandler(rr, req)
	return rr
}

func TestLogHandler_ValidLevels(t *testing.T) {
	levels := []string{"DEBUG", "INFO", "WARN", "ERROR"}
	for _, lvl := range levels {
		rr := postLog(t, map[string]any{
			"level": lvl,
			"layer": "frontend",
			"msg":   "test " + lvl,
		})
		if rr.Code != http.StatusNoContent {
			t.Errorf("level %s: expected 204, got %d", lvl, rr.Code)
		}
	}
}

func TestLogHandler_InvalidLevel(t *testing.T) {
	rr := postLog(t, map[string]any{
		"level": "TRACE",
		"layer": "frontend",
		"msg":   "should fail",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid level, got %d", rr.Code)
	}
}

func TestLogHandler_EmptyLevel(t *testing.T) {
	rr := postLog(t, map[string]any{
		"layer": "frontend",
		"msg":   "no level",
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty level, got %d", rr.Code)
	}
}

func TestLogHandler_MalformedJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/log", bytes.NewReader([]byte("not-json")))
	rr := httptest.NewRecorder()
	LogHandler(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for malformed JSON, got %d", rr.Code)
	}
}

func TestLogHandler_WithFields(t *testing.T) {
	rr := postLog(t, map[string]any{
		"level":  "INFO",
		"layer":  "frontend",
		"msg":    "with fields",
		"fields": map[string]any{"user": "alice", "page": 42},
	})
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d: %s", rr.Code, rr.Body.String())
	}
}
