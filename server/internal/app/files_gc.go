package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// CleanupFiles runs only while all application writers are stopped.
func (s *Server) CleanupFiles(ctx context.Context, apply bool) error {
	if s.Files == nil || s.DB == nil {
		return fmt.Errorf("file storage and database are required")
	}
	dir, err := s.Files.Root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(-1)
	if err != nil {
		return err
	}
	count := 0
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		if !fileIDPattern.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || !info.ModTime().Before(cutoff) {
			continue
		}
		var referenced, young bool
		if err = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE file_id=$1),EXISTS(SELECT 1 FROM attachments WHERE id=$1 AND created_at>=$2)`, entry.Name(), cutoff).Scan(&referenced, &young); err != nil {
			return err
		}
		if referenced || young {
			continue
		}
		count++
		if apply {
			if _, err = s.DB.Exec(ctx, "DELETE FROM attachments WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM messages WHERE file_id=$1)", entry.Name()); err != nil {
				return err
			}
			if err = s.Files.Root.Remove(entry.Name()); err != nil {
				return err
			}
		}
	}
	slog.Info("file_gc_completed", "apply", apply, "eligible_files", count)
	return nil
}
