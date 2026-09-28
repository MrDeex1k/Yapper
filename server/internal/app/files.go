package app

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Attachment struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	Filename  string `json:"filename"`
	Bytes     int64  `json:"bytes"`
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request, u User) {
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		fail(w, 429, "uploads_busy", "Too many active uploads.")
		return
	}
	channel := r.PathValue("channel")
	if !s.canAccess(r, u, channel) {
		fail(w, 403, "forbidden", "Channel access denied.")
		return
	}
	if s.Files == nil {
		fail(w, 503, "files_disabled", "File storage is disabled.")
		return
	}
	if r.Header.Get("Content-Encoding") != "" {
		fail(w, 415, "encoding_unsupported", "Compressed uploads are unsupported.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.Files.MaxBytes+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "multipart_required", "Send one multipart file field.")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		fail(w, 400, "file_required", "Choose a file.")
		return
	}
	defer part.Close()
	filename := path.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
	filename = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, filename)
	if filename == "" || filename == "." || filename == ".." || len(filename) > 255 || !utf8.ValidString(filename) {
		fail(w, 400, "filename_invalid", "Invalid filename.")
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(704222)"); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	var used int64
	if err = tx.QueryRow(r.Context(), "SELECT COALESCE(sum(bytes),0) FROM attachments").Scan(&used); err != nil {
		fail(w, 503, "database_unavailable", "Could not check quota.")
		return
	}
	limit := min(s.Files.MaxBytes, s.Files.QuotaBytes-used)
	if limit <= 0 {
		fail(w, 413, "quota_exceeded", "Instance file quota reached.")
		return
	}
	id, size, err := s.Files.Write(part, limit)
	if err != nil {
		if errors.Is(err, ErrFileLimit) {
			fail(w, 413, "file_limit", "File size or instance quota exceeded.")
		} else {
			fail(w, 400, "upload_failed", "Upload did not complete.")
		}
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = s.Files.Root.Remove(id)
		}
	}()
	if _, err = reader.NextPart(); !errors.Is(err, io.EOF) {
		fail(w, 400, "single_file_required", "Upload one file per request.")
		return
	}
	// Recheck access after receiving the body, before making metadata visible.
	current, err := s.sessionUser(r, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err != nil || !s.canAccess(r, current, channel) {
		fail(w, 403, "forbidden", "Access was revoked during upload.")
		return
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO attachments(id,channel_id,user_id,filename,bytes) VALUES($1,$2,$3,$4,$5)", id, channel, u.ID, filename, size); err != nil {
		fail(w, 503, "database_unavailable", "Could not save upload.")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "Could not save upload.")
		return
	}
	committed = true
	JSON(w, 201, Attachment{id, channel, filename, size})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request, u User) {
	if s.Files == nil {
		fail(w, 503, "files_disabled", "File storage is disabled.")
		return
	}
	var a Attachment
	err := s.DB.QueryRow(r.Context(), "SELECT a.id,a.channel_id,a.filename,a.bytes FROM attachments a JOIN channels c ON c.id=a.channel_id WHERE a.id=$3 AND "+accessible, u.Role, u.ID, r.PathValue("file")).Scan(&a.ID, &a.ChannelID, &a.Filename, &a.Bytes)
	if err != nil {
		fail(w, 404, "not_found", "File not found.")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/info") {
		JSON(w, 200, a)
		return
	}
	file, err := s.Files.Root.Open(a.ID)
	if err != nil {
		fail(w, 404, "not_found", "File unavailable.")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 404, "not_found", "File unavailable.")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": a.Filename}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, a.Filename, info.ModTime(), file)
}
