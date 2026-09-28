package app

import (
	"fmt"
	"net"
	"os"
	"time"
)

type Config struct {
	Address         string
	ShutdownTimeout time.Duration
	DatabaseURL     string
}

func LoadConfig() (Config, error) {
	c := Config{Address: os.Getenv("HTTP_ADDR"), ShutdownTimeout: 10 * time.Second, DatabaseURL: os.Getenv("DATABASE_URL")}
	if c.Address == "" {
		c.Address = "127.0.0.1:8080"
	}
	_, port, err := net.SplitHostPort(c.Address)
	if err != nil {
		return c, fmt.Errorf("HTTP_ADDR must be host:port: %w", err)
	}
	if port == "" {
		return c, fmt.Errorf("HTTP_ADDR must include a port")
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
