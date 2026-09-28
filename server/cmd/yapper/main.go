package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/MrDeex1k/Yapper/server/internal/app"
)

func run(ctx context.Context, cleanup, apply bool) error {
	c, err := app.LoadConfig()
	if err != nil {
		return err
	}
	s := app.NewServer()
	if c.FilesDir != "" {
		store, err := app.NewFileStore(c.FilesDir, c.MaxFileBytes, c.FileQuotaBytes)
		if err != nil {
			return err
		}
		s.Files = store
		defer store.Root.Close()
	}
	s.BootstrapToken = os.Getenv("BOOTSTRAP_TOKEN")
	if c.DatabaseURL != "" {
		startupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		pool, err := app.OpenDatabase(startupCtx, c.DatabaseURL)
		cancel()
		if err != nil {
			return err
		}
		defer pool.Close()
		s.DB = pool
		s.CheckDependency = func(ctx context.Context) error {
			probe, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			return pool.Ping(probe)
		}
	}
	if cleanup {
		return s.CleanupFiles(ctx, apply)
	}
	if os.Getenv("LIVEKIT_API_SECRET") != "" {
		media, err := app.NewMedia(os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"), os.Getenv("LIVEKIT_INTERNAL_URL"), os.Getenv("LIVEKIT_PUBLIC_URL"))
		if err != nil {
			return err
		}
		s.Media = media
	}
	mediaCtx, mediaCancel := context.WithCancel(ctx)
	var workers sync.WaitGroup
	workers.Go(func() { s.ReconcileMedia(mediaCtx) })
	defer func() { mediaCancel(); workers.Wait() }()
	handler := s.Handler()
	srv := &http.Server{Addr: c.Address, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 16 << 10, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := rand.Text()
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		started := time.Now()
		handler.ServeHTTP(w, r)
		slog.Info("request_completed", "request_id", id, "method", r.Method, "duration_ms", time.Since(started).Milliseconds())
	})}
	result := make(chan error, 1)
	go func() {
		slog.Info("server_listening", "address", c.Address, "version", app.Version)
		result <- srv.ListenAndServe()
	}()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		s.Drain()
		slog.Info("server_draining")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), c.ShutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			_ = srv.Close()
			return err
		}
		if err := <-result; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		slog.Info("server_stopped")
		return nil
	}
}
func main() {
	cleanup := flag.Bool("files-gc", false, "inspect unreferenced files older than 24 hours (stop writers first)")
	apply := flag.Bool("apply", false, "apply maintenance changes")
	flag.Parse()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *cleanup, *apply); err != nil {
		slog.Error("server_failed", "error", err)
		os.Exit(1)
	}
}
