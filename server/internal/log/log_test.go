package log

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func TestInit_CreatesLogFile(t *testing.T) {
	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatalf("Init returned error: %v", err)
	}
	logFile := filepath.Join(dir, "server.log")
	slog.Info("test message", "key", "value")

	if _, err := os.Stat(logFile); os.IsNotExist(err) {
		t.Fatalf("expected log file %s to exist", logFile)
	}
}

func TestInit_CreatesDirectoryIfAbsent(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "nested", "logs")
	if err := Init(dir); err != nil {
		t.Fatalf("Init returned error for non-existent dir: %v", err)
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Fatalf("expected directory %s to be created", dir)
	}
}

func TestInit_ReturnsErrorOnUnwritableDir(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("running as root; permission test not meaningful")
	}
	base := t.TempDir()
	// Make the base read-only so MkdirAll for a subdirectory fails.
	if err := os.Chmod(base, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(base, 0755) })

	dir := filepath.Join(base, "sub", "logs")
	if err := Init(dir); err == nil {
		t.Fatal("expected error for unwritable parent, got nil")
	}
}
