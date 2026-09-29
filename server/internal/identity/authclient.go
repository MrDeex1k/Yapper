package identity

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type AuthClient struct {
	base, secret string
	client       *http.Client
}

func NewAuthClient(base, secret string) (*AuthClient, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || (u.Scheme != "http" && u.Scheme != "https") || len(secret) < 32 {
		return nil, errors.New("invalid internal AUTH configuration")
	}
	return &AuthClient{base: strings.TrimRight(base, "/"), secret: secret, client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect denied") }}}, nil
}
func (c *AuthClient) post(ctx context.Context, path string, body, result any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.client.Do(req)
	if err != nil {
		return errors.New("authentication service unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errors.New("authentication service rejected request")
	}
	data, err = io.ReadAll(io.LimitReader(res.Body, 8193))
	if err != nil || len(data) > 8192 {
		return errors.New("invalid authentication response")
	}
	return json.Unmarshal(data, result)
}
func (c *AuthClient) Active(ctx context.Context, account Account) error {
	if account.SessionID == "" {
		return ErrUnauthorized
	}
	var result struct {
		Active bool `json:"active"`
	}
	err := c.post(ctx, "/internal/session-check", map[string]string{"subject": account.Subject, "sessionId": account.SessionID}, &result)
	if err != nil {
		return err
	}
	if !result.Active {
		return ErrUnauthorized
	}
	return nil
}
func (c *AuthClient) Provision(ctx context.Context, username, password string) (string, error) {
	var result struct {
		Subject string `json:"subject"`
	}
	err := c.post(ctx, "/internal/bootstrap", map[string]string{"username": username, "password": password}, &result)
	if err != nil {
		return "", err
	}
	if result.Subject == "" {
		return "", errors.New("empty account subject")
	}
	return result.Subject, nil
}
