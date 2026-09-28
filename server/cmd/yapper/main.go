package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/MrDeex1k/Yapper/server/internal/app"
)

func main() {
	c, err := app.LoadConfig()
	if err != nil {
		slog.Error("configuration_invalid", "error", err)
		os.Exit(1)
	}
	srv := &http.Server{Addr: c.Address, Handler: http.NewServeMux(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: time.Minute}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server_stopped", "error", err)
		os.Exit(1)
	}
}
