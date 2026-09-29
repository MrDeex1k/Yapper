package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/MrDeex1k/Yapper/server/internal/community"
	"github.com/MrDeex1k/Yapper/server/internal/httpapi"
	"github.com/MrDeex1k/Yapper/server/internal/identity"
	"github.com/MrDeex1k/Yapper/server/internal/media"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	verifier, err := identity.NewVerifier(os.Getenv("AUTH_ISSUER"), "yapper-api", os.Getenv("AUTH_JWKS_URL"))
	if err != nil {
		return err
	}
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	auth, err := identity.NewAuthClient(os.Getenv("AUTH_INTERNAL_URL"), os.Getenv("AUTH_INTERNAL_SECRET"))
	if err != nil {
		return err
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	startup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(startup, databaseURL)
	if err != nil {
		return errors.New("invalid database configuration")
	}
	defer pool.Close()
	if err = pool.Ping(startup); err != nil {
		return errors.New("database unavailable")
	}
	store := &community.Store{Pool: pool}
	if len(os.Args) == 2 && os.Args[1] == "migrate" {
		return store.Migrate(startup)
	}
	expires, err := time.Parse(time.RFC3339, os.Getenv("SETUP_TOKEN_EXPIRES_AT"))
	if err != nil {
		return errors.New("invalid setup token expiry")
	}
	mediaService, err := media.New(store, auth, os.Getenv("LIVEKIT_INTERNAL_URL"), os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"), os.Getenv("AUTH_ISSUER"))
	if err != nil {
		return err
	}
	defer mediaService.Close()
	api, err := httpapi.NewCommunity(store, verifier, auth, httpapi.CommunityConfig{Media: mediaService, Origin: os.Getenv("AUTH_ISSUER"), SetupToken: os.Getenv("SETUP_TOKEN"), SetupExpires: expires})
	if err != nil {
		return err
	}
	defer api.Close()
	server := &http.Server{Addr: address, Handler: api, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var workers sync.WaitGroup
	workers.Go(func() { mediaService.Reconcile(ctx) })
	defer func() { stop(); workers.Wait() }()
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	slog.Info("server listening", "address", address)
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		api.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
		err := <-done
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
