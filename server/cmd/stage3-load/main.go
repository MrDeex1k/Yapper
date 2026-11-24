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
	"os/signal"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"
	"uuid"

	"github.com/coder/websocket"
)

const installationName = "Stage 3 capacity"

const (
	onlineClients = 30
	batchSize     = 3
	eventDeadline = 2 * time.Second
	voiceDeadline = 5 * time.Second
	textDeadline  = 250 * time.Millisecond
)

type client struct {
	origin string
	http   *http.Client
	token  string
	id     string
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, *origin, *tone, *warmup, *duration)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, origin, tone string, warmup, duration time.Duration) (runErr error) {
	address, err := url.Parse(origin)
	if err != nil || origin != "http://"+address.Host || address.Hostname() != "127.0.0.1" {
		return errors.New("origin must be a loopback HTTP origin")
	}
	if warmup < 0 || duration < 10*time.Second || tone == "" {
		return errors.New("a tone file, nonnegative warmup, and duration of at least 10 seconds are required")
	}
	if err := validateTone(tone); err != nil {
		return fmt.Errorf("validate test tone: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, warmup+duration+4*time.Minute)
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
	var sockets []*eventStream
	defer func() {
		for _, stream := range sockets {
			stream.close()
		}
	}()
	for _, guest := range clients[:onlineClients] {
		connection, err := guest.openEvents(ctx)
		if err != nil {
			return err
		}
		sockets = append(sockets, connection)
	}
	voice, err := startVoiceBridge(ctx, origin)
	if err != nil {
		return err
	}
	defer voice.close()
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		runErr = errors.Join(runErr, voice.leaveAll(cleanup))
	}()
	for i, guest := range clients[:voiceClients] {
		if err := voice.join(ctx, i, guest, rooms[i/voiceRoomSize], tone); err != nil {
			return fmt.Errorf("voice participant %d: %w", i+1, err)
		}
	}
	fmt.Printf("Ready: 100 persisted identities including the owner, 30 event streams, 20 voice publishers with 10 per room\n")
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(warmup):
	}

	return sustain(ctx, clients, sockets, voice, rooms, text, tone, duration)
}

func sustain(ctx context.Context, clients []*client, sockets []*eventStream, voice *voiceBridge, rooms []string, text, tone string, duration time.Duration) error {
	started := time.Now()
	mediaStart := voice.snapshot()
	textPath := "/api/v1/channels/" + text + "/messages"
	var acks []time.Duration
	var socketRecoveries []time.Duration
	var acknowledged []message
	var recoveries []time.Duration
	beforeMedia := voice.packetCounts()
	tick := time.Tick(6 * time.Second)
	for i := 0; time.Since(started) < duration; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick:
		}
		if err := voice.verifyProgress(beforeMedia); err != nil {
			return err
		}
		if i > 0 && i%10 == 0 {
			index := (i / 10) % onlineClients
			sockets[index].close()
			begin := time.Now()
			stream, err := clients[index].openEvents(ctx)
			if err != nil {
				return fmt.Errorf("text reconnect: %w", err)
			}
			sockets[index] = stream
			socketRecoveries = append(socketRecoveries, time.Since(begin))
			speaker := (i / 10) % voiceClients
			begin = time.Now()
			recoveryCtx, cancel := context.WithDeadline(ctx, begin.Add(voiceDeadline))
			err = voice.replace(recoveryCtx, speaker, clients[speaker], rooms[speaker/voiceRoomSize], tone)
			cancel()
			if err != nil {
				return fmt.Errorf("voice reconnect: %w", err)
			}
			recoveries = append(recoveries, time.Since(begin))
		}
		beforeMedia = voice.packetCounts()
		batch, err := sendBatch(ctx, clients[:onlineClients], sockets, textPath, i)
		if err != nil {
			return err
		}
		for _, reply := range batch {
			acknowledged = append(acknowledged, reply.message)
			acks = append(acks, reply.elapsed)
		}
		if i%10 == 0 {
			packets := voice.snapshot().since(mediaStart).packets
			fmt.Printf("Progress after %s: %d acknowledged messages, %d received RTP packets\n", time.Since(started).Round(time.Second), len(acks), packets)
		}
	}
	elapsed := time.Since(started)
	media := voice.snapshot().since(mediaStart)
	if err := checkHistory(ctx, clients[0], text, acknowledged); err != nil {
		return err
	}
	if err := voice.verify(media); err != nil {
		return err
	}
	textP95, eventP95, voiceP95 := percentile95(acks), percentile95(socketRecoveries), percentile95(recoveries)
	fmt.Printf("Sustained %s; messages=%d; text acknowledgement p95=%s; event reconnects=%d p95=%s; voice reconnects=%d p95=%s\n",
		elapsed.Round(time.Second), len(acks), textP95, len(socketRecoveries), eventP95, len(recoveries), voiceP95)
	if textP95 > textDeadline || eventP95 > eventDeadline || voiceP95 > voiceDeadline {
		return errors.New("capacity run exceeded a latency threshold")
	}
	return nil
}

type acknowledgement struct {
	message message
	elapsed time.Duration
	err     error
}

func sendBatch(ctx context.Context, clients []*client, sockets []*eventStream, path string, round int) ([batchSize]acknowledgement, error) {
	var requested [batchSize]string
	for i := range requested {
		requested[i] = uuid.New().String()
	}
	for _, stream := range sockets {
		stream.expectBatch(requested)
	}
	var replies [batchSize]acknowledgement
	var workers sync.WaitGroup
	for slot := range replies {
		workers.Go(func() {
			index := round*batchSize + slot
			reply := &replies[slot]
			guest := clients[index%onlineClients]
			body := map[string]string{"requestId": requested[slot], "body": fmt.Sprintf("Stage 3 load message %d", index)}
			begin := time.Now()
			reply.err = guest.request(ctx, path, body, 200, &reply.message)
			reply.elapsed = time.Since(begin)
			if reply.err != nil {
				return
			}
			if reply.message.ID == "" || reply.message.RequestID != body["requestId"] {
				reply.err = errors.New("message acknowledgement did not identify its request")
				return
			}
			if index%10 == 0 {
				var replay message
				reply.err = guest.request(ctx, path, body, 200, &replay)
				if reply.err == nil && replay != reply.message {
					reply.err = errors.New("message retry changed the committed message")
				}
			}
		})
	}
	workers.Wait()
	var acknowledged [batchSize]message
	for i, reply := range replies {
		if reply.err != nil {
			return replies, reply.err
		}
		acknowledged[i] = reply.message
	}
	return replies, awaitEvents(ctx, sockets, acknowledged)
}

func awaitEvents(ctx context.Context, sockets []*eventStream, acknowledged [batchSize]message) error {
	deadline, cancel := context.WithTimeout(ctx, eventDeadline)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		waiting := 0
		for i, stream := range sockets {
			select {
			case <-stream.stopped:
				return fmt.Errorf("participant %d lost its event stream", i+1)
			default:
			}
			if !stream.receivedBatch(acknowledged) {
				waiting++
			}
		}
		if waiting == 0 {
			return nil
		}
		select {
		case <-deadline.Done():
			return fmt.Errorf("%d participants missed chat events: %w", waiting, deadline.Err())
		case <-tick.C:
		}
	}
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

type eventStream struct {
	connection *websocket.Conn
	stopped    chan struct{}
	mu         sync.Mutex
	received   [batchSize]message
}

func (s *eventStream) close() { _ = s.connection.CloseNow() }

func (s *eventStream) expectBatch(requestIDs [batchSize]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, id := range requestIDs {
		s.received[i] = message{RequestID: id}
	}
}

func (s *eventStream) recordMessage(created message) {
	if created.ID == "" || created.RequestID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, pending := range s.received {
		if pending.RequestID == created.RequestID && pending.ID == "" {
			s.received[i] = created
			return
		}
	}
}

func (s *eventStream) receivedBatch(acknowledged [batchSize]message) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.received == acknowledged
}

func (c *client) openEvents(ctx context.Context) (*eventStream, error) {
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
	stream := &eventStream{connection: connection, stopped: make(chan struct{})}
	go func() {
		defer close(stream.stopped)
		for {
			_, data, err := connection.Read(ctx)
			if err != nil {
				return
			}
			var msg struct {
				Type    string  `json:"type"`
				Payload message `json:"payload"`
			}
			if json.Unmarshal(data, &msg) == nil && msg.Type == "message.created" {
				stream.recordMessage(msg.Payload)
			}
		}
	}()
	return stream, nil
}

func percentile95(values []time.Duration) time.Duration {
	if len(values) == 0 {
		return 0
	}
	slices.Sort(values)
	return values[(95*len(values)+99)/100-1]
}
