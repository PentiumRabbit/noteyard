// Package config manages application configuration via ~/.config/noteyard/config.toml.
package config

import (
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/BurntSushi/toml"
)

// Config is the in-memory representation of config.toml.
type Config struct {
	Data   DataConfig   `toml:"data"`
	Backup BackupConfig `toml:"backup"`
}

// DataConfig holds data directory settings.
type DataConfig struct {
	Dir string `toml:"dir"`
}

// BackupConfig holds backup settings.
type BackupConfig struct {
	OpsThreshold int `toml:"ops_threshold"`
}

const defaultOpsThreshold = 50

// DefaultDataDir returns the platform-appropriate default data directory.
func DefaultDataDir() string {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "noteyard"
		}
		return filepath.Join(home, "Library", "Application Support", "noteyard")
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "noteyard"
			}
			appData = home
		}
		return filepath.Join(appData, "noteyard")
	default: // linux and others
		home, err := os.UserHomeDir()
		if err != nil {
			return "noteyard"
		}
		return filepath.Join(home, ".local", "share", "noteyard")
	}
}

// ConfigFilePath returns the path to config.toml.
func ConfigFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "config.toml"
	}
	return filepath.Join(home, ".config", "noteyard", "config.toml")
}

// defaults returns a Config populated with platform defaults.
func defaults() Config {
	return Config{
		Data:   DataConfig{Dir: DefaultDataDir()},
		Backup: BackupConfig{OpsThreshold: defaultOpsThreshold},
	}
}

// Load reads config.toml. If the file does not exist it creates it with
// platform defaults. If the file is malformed it falls back to defaults and
// logs a warning. The returned Config is always non-nil and usable.
func Load() *Config {
	path := ConfigFilePath()

	// File does not exist → write defaults and return them.
	if _, err := os.Stat(path); os.IsNotExist(err) {
		cfg := defaults()
		if writeErr := Write(&cfg); writeErr != nil {
			log.Printf("[config] could not write default config: %v", writeErr)
		}
		return &cfg
	}

	cfg := defaults()
	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		log.Printf("[config] failed to parse %s (using defaults): %v", path, err)
		return &cfg
	}

	// Ensure non-zero threshold.
	if cfg.Backup.OpsThreshold <= 0 {
		cfg.Backup.OpsThreshold = defaultOpsThreshold
	}
	return &cfg
}

// Write persists cfg to ConfigFilePath(), creating parent directories as needed.
func Write(cfg *Config) error {
	path := ConfigFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(cfg)
}
