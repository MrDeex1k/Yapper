package app

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

type Config struct {
	MaxScreens      int
	AllowScreen     bool
	FilesDir        string
	MaxFileBytes    int64
	FileQuotaBytes  int64
	Address         string
	ShutdownTimeout time.Duration
	DatabaseURL     string
}

func LoadConfig() (Config, error) {
	c := Config{Address: os.Getenv("HTTP_ADDR"), ShutdownTimeout: 10 * time.Second, DatabaseURL: os.Getenv("DATABASE_URL")}
	c.MaxScreens = 2
	if raw := os.Getenv("MAX_SCREEN_SHARES"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 || v > 64 {
			return c, fmt.Errorf("MAX_SCREEN_SHARES must be 1–64")
		}
		c.MaxScreens = v
	}
	c.AllowScreen = true
	if raw := os.Getenv("ALLOW_SCREEN_SHARE"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			return c, fmt.Errorf("ALLOW_SCREEN_SHARE must be boolean")
		}
		c.AllowScreen = v
	}
	c.FilesDir = os.Getenv("FILES_DIR")
	c.MaxFileBytes = 16 << 20
	c.FileQuotaBytes = 1 << 30
	for key, target := range map[string]*int64{"MAX_FILE_BYTES": &c.MaxFileBytes, "FILE_QUOTA_BYTES": &c.FileQuotaBytes} {
		if raw := os.Getenv(key); raw != "" {
			v, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || v < 1 {
				return c, fmt.Errorf("%s must be positive bytes", key)
			}
			*target = v
		}
	}
	if c.MaxFileBytes > c.FileQuotaBytes || c.MaxFileBytes > 1<<40 {
		return c, fmt.Errorf("file size exceeds quota or 1 TiB maximum")
	}
	if c.Address == "" {
		c.Address = "127.0.0.1:8080"
	}
	if _, _, err := net.SplitHostPort(c.Address); err != nil {
		return c, fmt.Errorf("HTTP_ADDR must be host:port: %w", err)
	}
	if raw := os.Getenv("SHUTDOWN_TIMEOUT"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 || d > time.Minute {
			return c, fmt.Errorf("SHUTDOWN_TIMEOUT must be between 0 and 1m")
		}
		c.ShutdownTimeout = d
	}
	return c, nil
}
