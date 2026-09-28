package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
)

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]any{"error": APIError{code, message}})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		fail(w, 415, "content_type", "Use application/json.")
		return false
	}
	if r.Header.Get("Content-Encoding") != "" {
		fail(w, 415, "content_encoding", "Encoded request bodies are not supported.")
		return false
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		fail(w, 413, "body_limit", "Request body is too large.")
		return false
	}
	tokens := json.NewDecoder(bytes.NewReader(data))
	if err = uniqueJSON(tokens, 0); err != nil {
		fail(w, 400, "invalid_json", "Invalid or duplicate JSON fields.")
		return false
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err = d.Decode(dst); err != nil {
		fail(w, 400, "invalid_json", "Invalid request fields.")
		return false
	}
	if err = d.Decode(new(any)); !errors.Is(err, io.EOF) {
		fail(w, 400, "invalid_json", "Expected one JSON value.")
		return false
	}
	return true
}
func uniqueJSON(d *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("nesting limit")
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	switch token {
	case json.Delim('{'):
		seen := map[string]bool{}
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return errors.New("duplicate key")
			}
			seen[name] = true
			if err = uniqueJSON(d, depth+1); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	case json.Delim('['):
		for d.More() {
			if err = uniqueJSON(d, depth+1); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	}
	return nil
}
