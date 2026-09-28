package app

import (
	"crypto/rand"
	"errors"
	"io"
	"os"
	"regexp"
)

var fileIDPattern = regexp.MustCompile(`^[A-Z2-7]{26}$`)

var ErrFileLimit = errors.New("file exceeds configured limit")

type FileStore struct {
	Root                 *os.Root
	MaxBytes, QuotaBytes int64
}

func NewFileStore(dir string, maxBytes, quotaBytes int64) (*FileStore, error) {
	if maxBytes < 1 || quotaBytes < maxBytes || maxBytes > 1<<40 {
		return nil, errors.New("invalid file limits")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &FileStore{root, maxBytes, quotaBytes}, nil
}
func (s *FileStore) Write(source io.Reader, limit int64) (id string, size int64, err error) {
	id = rand.Text()
	f, err := s.Root.OpenFile(id, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", 0, err
	}
	defer func() {
		_ = f.Close()
		if err != nil {
			_ = s.Root.Remove(id)
		}
	}()
	size, err = io.Copy(f, io.LimitReader(source, limit+1))
	if err != nil {
		return id, size, err
	}
	if size > limit {
		return id, size, ErrFileLimit
	}
	if err = f.Sync(); err != nil {
		return id, size, err
	}
	err = f.Close()
	return id, size, err
}
