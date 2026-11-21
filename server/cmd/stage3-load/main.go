// stage3-load drives a disposable Yapper installation through the public API.
package main

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"uuid"

	"github.com/coder/websocket"
)

const installationName = "Stage 3 capacity"

type client struct {
	origin string
	http   *http.Client
	token  string
	id     string
	events atomic.Int64
}

type state struct {
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
}

type channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type membership struct {
	Channels []channel `json:"channels"`
}

type message struct {
	ID        string `json:"id"`
	RequestID string `json:"requestId"`
}

func main() {
	origin := flag.String("origin", "http://127.0.0.1:18090", "disposable loopback installation")
	duration := flag.Duration("duration", 30*time.Minute, "sustained test time")
	warmup := flag.Duration("warmup", time.Minute, "warmup after all clients join")
	tone := flag.String("tone", "", "Ogg Opus fixture covering the warmup and test duration")
	flag.Parse()

	if err := run(*origin, *tone, *warmup, *duration); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(origin, tone string, warmup, duration time.Duration) error {
	address, err := url.Parse(origin)
	if err != nil || origin != "http://"+address.Host || address.Hostname() != "127.0.0.1" {
		return errors.New("origin must be a loopback HTTP origin")
	}
	if warmup < 0 || duration < 10*time.Second || tone == "" {
		return errors.New("a tone file, nonnegative warmup, and duration of at least 10 seconds are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), warmup+duration+4*time.Minute)
	defer cancel()

	admin := newClient(origin)
	setup := os.Getenv("STAGE3_SETUP_TOKEN")
	if setup == "" {
		return errors.New("STAGE3_SETUP_TOKEN is required for a fresh disposable installation")
	}
	var initial state
	if err := admin.request(ctx, "/api/v1/state", nil, 200, &initial); err != nil {
		return err
	}
	if initial.Configured {
		return errors.New("run against an empty disposable Stage 3 capacity installation")
	}
	password := uuid.New().String() + uuid.New().String()
	if err := admin.request(ctx, "/api/v1/setup", map[string]string{
		"name": installationName, "token": setup, "username": "capacityowner", "password": password,
	}, 201, nil); err != nil {
		return err
	}
	if err := admin.request(ctx, "/api/auth/sign-in/username", map[string]string{
		"username": "capacityowner", "password": password,
	}, 200, nil); err != nil {
		return err
	}
	var auth struct {
		Token string `json:"token"`
	}
	if err := admin.request(ctx, "/api/auth/token", nil, 200, &auth); err != nil {
		return err
	}
	admin.token = auth.Token
	if err := admin.request(ctx, "/api/v1/admission", map[string]bool{"openAdmission": true}, 200, nil); err != nil {
		return err
	}
	if err := admin.request(ctx, "/api/v1/channels", map[string]string{
		"name": "Capacity B", "kind": "voice", "categoryId": "",
	}, 200, nil); err != nil {
		return err
	}
	var me membership
	if err := admin.request(ctx, "/api/v1/me", nil, 200, &me); err != nil {
		return err
	}
	var text string
	var rooms []string
	for _, channel := range me.Channels {
		if channel.Kind == "text" {
			text = channel.ID
		} else if channel.Kind == "voice" {
			rooms = append(rooms, channel.ID)
		}
	}
	if text == "" || len(rooms) != 2 {
		return errors.New("test installation needs one text channel and two voice channels")
	}

	clients := make([]*client, 99)
	for i := range clients {
		guest := newClient(origin)
		var admitted struct {
			ID string `json:"id"`
		}
		if err := guest.request(ctx, "/api/v1/guests", map[string]string{
			"nickname": fmt.Sprintf("Capacity %02d", i+1),
		}, 201, &admitted); err != nil {
			return fmt.Errorf("admit participant %d: %w", i+1, err)
		}
		guest.id = admitted.ID
		clients[i] = guest
	}
	unique := make(map[string]bool, 100)
	for _, guest := range clients {
		if guest.id == "" || unique[guest.id] {
			return errors.New("guest identities are missing or duplicated")
		}
		unique[guest.id] = true
	}
	var sockets []*websocket.Conn
	for _, guest := range clients[:30] {
		connection, err := guest.openEvents(ctx)
		if err != nil {
			return err
		}
		sockets = append(sockets, connection)
		defer connection.CloseNow()
	}
	voice, err := startVoiceBridge(ctx, origin)
	if err != nil {
		return err
	}
	defer voice.close()
	for i, guest := range clients[:20] {
		if err := voice.join(ctx, i, guest, rooms[i/10], tone); err != nil {
			return fmt.Errorf("voice participant %d: %w", i+1, err)
		}
	}
	defer voice.leaveAll(ctx)
	fmt.Printf("Ready: 100 persisted identities including the owner, 30 event streams, 20 voice publishers with 10 per room\n")
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(warmup):
	}

	return sustain(ctx, clients, sockets, voice, rooms, text, tone, duration)
}

func sustain(ctx context.Context, clients []*client, sockets []*websocket.Conn, voice *voiceBridge, rooms []string, text, tone string, duration time.Duration) error {
	started := time.Now()
	textPath := "/api/v1/channels/" + text + "/messages"
	var acks []time.Duration
	var socketRecoveries []time.Duration
	var acknowledged []message
	var recoveries []time.Duration
	defer func() {
		for _, connection := range sockets {
			_ = connection.CloseNow()
		}
	}()
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for i := 0; time.Since(started) < duration; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
		guest := clients[i%30]
		body := map[string]string{"requestId": uuid.New().String(), "body": fmt.Sprintf("Stage 3 load message %d", i)}
		var committed message
		begin := time.Now()
		if err := guest.request(ctx, textPath, body, 200, &committed); err != nil {
			return err
		}
		acks = append(acks, time.Since(begin))
		if committed.ID == "" || committed.RequestID != body["requestId"] {
			return errors.New("message acknowledgement did not identify its request")
		}
		acknowledged = append(acknowledged, committed)
		if i%10 == 0 {
			var retry message
			if err := guest.request(ctx, textPath, body, 200, &retry); err != nil || retry != committed {
				return fmt.Errorf("message retry failed idempotency: %w", errors.Join(err, errors.New("response did not preserve the committed message")))
			}
		}
		if i > 0 && i%30 == 0 {
			index := (i / 30) % 30
			_ = sockets[index].CloseNow()
			begin = time.Now()
			var err error
			sockets[index], err = clients[index].openEvents(ctx)
			if err != nil {
				return fmt.Errorf("text reconnect: %w", err)
			}
			socketRecoveries = append(socketRecoveries, time.Since(begin))
			speaker := (i / 30) % 20
			begin = time.Now()
			if err := voice.replace(ctx, speaker, clients[speaker], rooms[speaker/10], tone); err != nil {
				return fmt.Errorf("voice reconnect: %w", err)
			}
			recoveries = append(recoveries, time.Since(begin))
		}
		if i%30 == 0 {
			fmt.Printf("Progress after %s: %d acknowledged messages, %d received RTP packets\n", time.Since(started).Round(time.Second), len(acks), voice.packets.Load())
		}
	}
	for i, client := range clients[:30] {
		if client.events.Load() < 2 {
			return fmt.Errorf("participant %d did not receive a chat event", i+1)
		}
	}
	if err := checkHistory(ctx, clients[0], text, acknowledged); err != nil {
		return err
	}
	if err := voice.verify(); err != nil {
		return err
	}
	fmt.Printf("Sustained %s; messages=%d; text acknowledgement p95=%s; event reconnects=%d p95=%s; voice reconnects=%d p95=%s\n",
		time.Since(started).Round(time.Second), len(acks), percentile95(acks), len(socketRecoveries), percentile95(socketRecoveries), len(recoveries), percentile95(recoveries))
	return nil
}

func checkHistory(ctx context.Context, guest *client, text string, messages []message) error {
	wanted := make(map[string]string, len(messages))
	for _, entry := range messages {
		wanted[entry.RequestID] = entry.ID
	}
	found := make(map[string]bool, len(messages))
	for before := int64(0); ; {
		var page struct {
			Before   int64     `json:"before"`
			Messages []message `json:"messages"`
		}
		route := fmt.Sprintf("/api/v1/channels/%s/timeline?before=%d", text, before)
		if err := guest.request(ctx, route, nil, 200, &page); err != nil {
			return err
		}
		for _, msg := range page.Messages {
			if id, ok := wanted[msg.RequestID]; ok {
				if msg.ID != id || found[msg.RequestID] {
					return errors.New("committed request appeared more than once or changed ID")
				}
				found[msg.RequestID] = true
			}
		}
		if page.Before == 0 {
			break
		}
		if before > 0 && page.Before >= before {
			return errors.New("timeline cursor did not move backwards")
		}
		before = page.Before
	}
	if len(found) != len(wanted) {
		return fmt.Errorf("timeline contained %d of %d acknowledged sends", len(found), len(wanted))
	}
	return nil
}

func newClient(origin string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{origin: origin, http: &http.Client{
		Jar: jar, Timeout: 8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (c *client) request(ctx context.Context, route string, body any, status int, output any) error {
	method := http.MethodGet
	var input io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		input = bytes.NewReader(payload)
		method = http.MethodPost
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+route, input)
	if err != nil {
		return err
	}
	req.Header.Set("Origin", c.origin)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != status {
		return fmt.Errorf("%s %s received %d; want %d", method, route, response.StatusCode, status)
	}
	if output == nil {
		_, err = io.Copy(io.Discard, response.Body)
		return err
	}
	return json.UnmarshalRead(response.Body, output)
}

func (c *client) openEvents(ctx context.Context) (*websocket.Conn, error) {
	var ticket struct {
		Value string `json:"ticket"`
	}
	if err := c.request(ctx, "/api/v1/events/ticket", struct{}{}, 201, &ticket); err != nil {
		return nil, err
	}
	deadline, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	address := "ws" + strings.TrimPrefix(c.origin, "http") + "/api/v1/events"
	connection, _, err := websocket.Dial(deadline, address, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": {c.origin}}, Subprotocols: []string{"yapper.v1", "yapper.ticket." + ticket.Value},
	})
	if err != nil {
		return nil, fmt.Errorf("connect event stream: %w", err)
	}
	_, data, err := connection.Read(deadline)
	var event struct {
		Type string `json:"type"`
	}
	if err != nil || json.Unmarshal(data, &event) != nil || event.Type != "ready" {
		_ = connection.CloseNow()
		return nil, errors.New("event stream did not send ready")
	}
	c.events.Add(1)
	go func() {
		for {
			_, data, err := connection.Read(ctx)
			if err != nil {
				return
			}
			var msg struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(data, &msg) == nil && msg.Type == "message.created" {
				c.events.Add(1)
			}
		}
	}()
	return connection, nil
}

func percentile95(values []time.Duration) time.Duration {
	if len(values) == 0 {
		return 0
	}
	slices.Sort(values)
	return values[(95*len(values)+99)/100-1]
}
