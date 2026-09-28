package app

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

var usernamePattern = regexp.MustCompile(`^[a-z0-9_-]{3,32}$`)

func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func validCredentials(username, password string) bool {
	return usernamePattern.MatchString(username) && len(password) >= 12 && len(password) <= 72
}
func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Token    string `json:"token"`
	}
	if !decode(w, r, &body) {
		return
	}
	if s.BootstrapToken == "" || subtle.ConstantTimeCompare([]byte(tokenHash(body.Token)), []byte(tokenHash(s.BootstrapToken))) != 1 {
		fail(w, 403, "bootstrap_denied", "Bootstrap is disabled or the token is invalid.")
		return
	}
	if !validCredentials(body.Username, body.Password) {
		fail(w, 400, "credentials_invalid", "Use a 3–32 character lowercase username and a 12–72 byte password.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "hash_failed", "Could not create account.")
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(704220)"); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	var count int
	if err = tx.QueryRow(r.Context(), "SELECT count(*) FROM users").Scan(&count); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	if count != 0 {
		fail(w, 409, "already_initialized", "This instance already has an administrator.")
		return
	}
	user := User{rand.Text(), body.Username, "admin"}
	if _, err = tx.Exec(r.Context(), "INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,'admin')", user.ID, user.Username, string(hash)); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO channels(id,name) VALUES($1,'general')", rand.Text()); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	JSON(w, 201, user)
}
func (s *Server) authenticated(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || len(raw) > 256 {
			fail(w, 401, "unauthorized", "Sign in to continue.")
			return
		}
		user, err := s.sessionUser(r, raw)
		if err != nil {
			fail(w, 401, "unauthorized", "Session expired or revoked.")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next(w, r, user)
	}
}
func (s *Server) sessionUser(r *http.Request, raw string) (User, error) {
	var user User
	err := s.DB.QueryRow(r.Context(), `SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.banned`, tokenHash(raw)).Scan(&user.ID, &user.Username, &user.Role)
	return user, err
}
func (s *Server) newSession(w http.ResponseWriter, r *http.Request, user User) {
	raw := rand.Text()
	expiry := time.Now().Add(7 * 24 * time.Hour)
	if _, err := s.DB.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", tokenHash(raw), user.ID, expiry); err != nil {
		fail(w, 503, "database_unavailable", "Could not create session.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	JSON(w, 200, map[string]any{"token": raw, "expires_at": expiry, "user": user})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Password) > 72 || len(body.Password) < 12 || !usernamePattern.MatchString(body.Username) {
		fail(w, 401, "invalid_credentials", "Incorrect username or password.")
		return
	}
	var user User
	var hash string
	err := s.DB.QueryRow(r.Context(), "SELECT id,username,role,password_hash FROM users WHERE username=$1 AND NOT banned", body.Username).Scan(&user.ID, &user.Username, &user.Role, &hash)
	if err != nil {
		_, _ = bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		fail(w, 401, "invalid_credentials", "Incorrect username or password.")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		fail(w, 401, "invalid_credentials", "Incorrect username or password.")
		return
	}
	s.newSession(w, r, user)
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Invite   string `json:"invite"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !validCredentials(body.Username, body.Password) || len(body.Invite) > 256 {
		fail(w, 400, "credentials_invalid", "Use a valid username, invitation and 12–72 byte password.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "hash_failed", "Could not create account.")
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), "UPDATE invites SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()", tokenHash(body.Invite))
	if err != nil || tag.RowsAffected() != 1 {
		fail(w, 400, "invalid_invite", "Invitation expired or was already used.")
		return
	}
	user := User{rand.Text(), body.Username, "member"}
	if _, err = tx.Exec(r.Context(), "INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)", user.ID, user.Username, string(hash)); err != nil {
		fail(w, 409, "registration_conflict", "Username unavailable.")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	s.newSession(w, r, user)
}
func (s *Server) createInvite(w http.ResponseWriter, r *http.Request, user User) {
	if user.Role != "admin" {
		fail(w, 403, "forbidden", "Administrator access required.")
		return
	}
	raw := rand.Text()
	expiry := time.Now().Add(24 * time.Hour)
	if _, err := s.DB.Exec(r.Context(), "INSERT INTO invites(token_hash,created_by,expires_at) VALUES($1,$2,$3)", tokenHash(raw), user.ID, expiry); err != nil {
		fail(w, 503, "database_unavailable", "Try again later.")
		return
	}
	JSON(w, 201, map[string]any{"invite": raw, "expires_at": expiry})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request, user User) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if _, err := s.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", tokenHash(raw)); err != nil {
		fail(w, 503, "database_unavailable", "Could not revoke session.")
		return
	}
	w.WriteHeader(204)
}
