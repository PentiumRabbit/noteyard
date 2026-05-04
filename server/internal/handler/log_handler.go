package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type logEntry struct {
	Level  string         `json:"level"`
	Layer  string         `json:"layer"`
	Msg    string         `json:"msg"`
	Fields map[string]any `json:"fields"`
}

func LogHandler(w http.ResponseWriter, r *http.Request) {
	var entry logEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	var level slog.Level
	switch entry.Level {
	case "DEBUG":
		level = slog.LevelDebug
	case "INFO":
		level = slog.LevelInfo
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	default:
		http.Error(w, "invalid level", http.StatusBadRequest)
		return
	}

	attrs := []any{"layer", entry.Layer}
	for k, v := range entry.Fields {
		attrs = append(attrs, k, v)
	}
	slog.Log(r.Context(), level, entry.Msg, attrs...)

	w.WriteHeader(http.StatusNoContent)
}
