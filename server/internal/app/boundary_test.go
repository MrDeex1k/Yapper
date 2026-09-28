package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRejectsAmbiguity(t *testing.T) {
	for _, body := range []string{`{"name":"a","name":"b"}`, `{"name":"a"} {"name":"b"}`, `{"other":"a"}`, strings.Repeat(" ", 65537)} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		var value struct {
			Name string `json:"name"`
		}
		if decode(w, r, &value) {
			t.Fatalf("accepted invalid body: %.80s", body)
		}
	}
}
