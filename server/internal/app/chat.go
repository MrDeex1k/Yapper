package app

import (
	"crypto/rand"
	"net/http"
	"strings"
	"unicode/utf8"
)

type Channel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Private bool   `json:"private"`
}

const accessible = `(NOT c.private OR $1='admin' OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=$2))`

func (s *Server) canAccess(r *http.Request, user User, id string) bool {
	var ok bool
	err := s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM channels c WHERE c.id=$3 AND "+accessible+")", user.Role, user.ID, id).Scan(&ok)
	return err == nil && ok
}
func (s *Server) channels(w http.ResponseWriter, r *http.Request, user User) {
	rows, err := s.DB.Query(r.Context(), "SELECT c.id,c.name,c.kind,c.private FROM channels c WHERE "+accessible+" ORDER BY c.created_at,c.id", user.Role, user.ID)
	if err != nil {
		fail(w, 503, "database_unavailable", "Could not load channels.")
		return
	}
	defer rows.Close()
	channels := []Channel{}
	for rows.Next() {
		var c Channel
		if err = rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Private); err != nil {
			fail(w, 500, "read_failed", "Could not load channels.")
			return
		}
		channels = append(channels, c)
	}
	if rows.Err() != nil {
		fail(w, 503, "database_unavailable", "Could not load channels.")
		return
	}
	JSON(w, 200, map[string]any{"channels": channels})
}
func (s *Server) createChannel(w http.ResponseWriter, r *http.Request, user User) {
	if user.Role != "admin" {
		fail(w, 403, "forbidden", "Administrator access required.")
		return
	}
	var body struct {
		Name    string `json:"name"`
		Private bool   `json:"private"`
		Kind    string `json:"kind"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Kind == "" {
		body.Kind = "text"
	}
	if body.Name == "" || utf8.RuneCountInString(body.Name) > 64 || body.Kind != "text" {
		fail(w, 400, "channel_invalid", "Use a name of 1–64 characters and a text channel.")
		return
	}
	c := Channel{rand.Text(), body.Name, body.Kind, body.Private}
	if _, err := s.DB.Exec(r.Context(), "INSERT INTO channels(id,name,kind,private) VALUES($1,$2,$3,$4)", c.ID, c.Name, c.Kind, c.Private); err != nil {
		fail(w, 503, "database_unavailable", "Could not create channel.")
		return
	}
	JSON(w, 201, c)
}
