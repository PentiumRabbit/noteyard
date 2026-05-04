package log

import (
	"log/slog"
	"os"
	"path/filepath"

	"gopkg.in/natefinch/lumberjack.v2"
)

// Init initializes the global slog handler backed by a lumberjack rotating file.
// logDir is the directory where server.log will be written; it is created if absent.
// On any failure the process exits via log.Fatal.
func Init(logDir string) error {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return err
	}

	w := &lumberjack.Logger{
		Filename:   filepath.Join(logDir, "server.log"),
		MaxSize:    10,
		MaxBackups: 5,
		Compress:   true,
	}

	h := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelDebug})
	slog.SetDefault(slog.New(h))
	return nil
}
