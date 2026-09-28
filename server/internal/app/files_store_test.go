package app

import (
	"errors"
	"strings"
	"testing"
)

func TestFileStoreBoundaries(t *testing.T) {
	s, err := NewFileStore(t.TempDir(), 4, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Root.Close()
	id, n, err := s.Write(strings.NewReader("1234"), 4)
	if err != nil || n != 4 {
		t.Fatal(id, n, err)
	}
	f, err := s.Root.Open(id)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	id, _, err = s.Write(strings.NewReader("12345"), 4)
	if !errors.Is(err, ErrFileLimit) {
		t.Fatal(err)
	}
	if _, err = s.Root.Stat(id); err == nil {
		t.Fatal("oversized file retained")
	}
	if _, err = s.Root.Open("../outside"); err == nil {
		t.Fatal("escaped storage root")
	}
}
