package deployment

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/coder/websocket"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/pion/turn/v5"
	"google.golang.org/protobuf/proto"
)

// Run with scripts/test-turn.ts, which supplies an isolated container network.
func TestTURNDeployment(t *testing.T) {
	if os.Getenv("YAPPER_TURN_TEST") != "1" {
		t.Skip("run pnpm test:turn for the isolated TURN deployment")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	cert, err := os.ReadFile("/test/certs/fullchain.pem")
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(cert) {
		t.Fatal("invalid test CA")
	}
	const endpoint = "tls-router:8443"
	dial := func(name string, roots *x509.CertPool) (net.Conn, error) {
		d := tls.Dialer{Config: &tls.Config{ServerName: name, RootCAs: roots, MinVersion: tls.VersionTLS12}}
		return d.DialContext(ctx, "tcp", endpoint)
	}
	t.Run("untrusted certificate rejected", func(t *testing.T) {
		c, err := dial("turn.yapper.test", nil)
		if err == nil {
			c.Close()
			t.Fatal("untrusted certificate accepted")
		}
		if _, ok := errors.AsType[*tls.CertificateVerificationError](err); !ok {
			t.Fatalf("expected certificate rejection, got %v", err)
		}
	})
	t.Run("HTTPS shares TLS router", func(t *testing.T) {
		transport := &http.Transport{DialTLSContext: func(context.Context, string, string) (net.Conn, error) {
			return dial("web.yapper.test", roots)
		}}
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
		req, err := http.NewRequestWithContext(ctx, "GET", "https://web.yapper.test/", nil)
		if err != nil {
			t.Fatal(err)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, err := io.ReadAll(io.LimitReader(res.Body, 1024))
		if err != nil || res.StatusCode != 200 || string(body) != "https-route-ok" {
			t.Fatalf("HTTPS routing failed: status %d, error %v", res.StatusCode, err)
		}
	})

	// Obtain credentials from the real pinned server's signaling response, rather
	// than reproducing its credential derivation algorithm in the test.
	identity := uuid.New().String()
	token, err := auth.NewAccessToken(os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET")).
		SetIdentity(identity).SetValidFor(time.Minute).
		SetVideoGrant(&auth.VideoGrant{RoomJoin: true, Room: "turn-" + identity}).ToJWT()
	if err != nil {
		t.Fatal("create isolated signaling grant", err)
	}
	ws, _, err := websocket.Dial(ctx, "ws://livekit-turn:7880/rtc?protocol=15&access_token="+url.QueryEscape(token), nil)
	if err != nil {
		t.Fatal("signaling connection failed")
	}
	defer ws.CloseNow()
	_, data, err := ws.Read(ctx)
	if err != nil {
		t.Fatal("signaling response failed")
	}
	var response livekit.SignalResponse
	if err = proto.Unmarshal(data, &response); err != nil {
		t.Fatal("invalid signaling response")
	}
	var ice *livekit.ICEServer
	for _, server := range response.GetJoin().GetIceServers() {
		for _, address := range server.Urls {
			if strings.HasPrefix(address, "turns:") {
				if address != "turns:turn.yapper.test:443?transport=tcp" {
					t.Fatal("unexpected advertised TURN endpoint", address)
				}
				ice = server
			}
		}
	}
	if ice == nil || ice.Username == "" || ice.Credential == "" {
		t.Fatal("signaling did not provide TURN credentials")
	}
	newClient := func(t *testing.T, password string) *turn.Client {
		t.Helper()
		conn, err := dial("turn.yapper.test", roots)
		if err != nil {
			t.Fatal("TURN TLS connection", err)
		}
		t.Cleanup(func() { conn.Close() })
		if err = conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
			t.Fatal(err)
		}
		client, err := turn.NewClient(&turn.ClientConfig{
			STUNServerAddr: endpoint, TURNServerAddr: endpoint,
			Conn: turn.NewSTUNConn(conn), Username: ice.Username, Password: password, Realm: "livekit",
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(client.Close)
		if err = client.Listen(); err != nil {
			t.Fatal(err)
		}
		return client
	}
	t.Run("invalid credentials rejected", func(t *testing.T) {
		client := newClient(t, "incorrect-password")
		relay, err := client.Allocate()
		if err == nil {
			relay.Close()
			t.Fatal("unauthorized relay allocation")
		}
	})
	t.Run("authenticated relay and peer policy", func(t *testing.T) {
		client := newClient(t, ice.Credential)
		mapped, err := client.SendBindingRequest()
		if err != nil {
			t.Fatal(err)
		}
		mappedIP, _, err := net.SplitHostPort(mapped.String())
		if err != nil || mappedIP != "172.30.245.4" {
			t.Fatal("TURN reported proxy address instead of client address")
		}
		relay, err := client.Allocate()
		if err != nil {
			t.Fatal("relay allocation", err)
		}
		defer relay.Close()
		address, ok := relay.LocalAddr().(*net.UDPAddr)
		if !ok || !address.IP.Equal(net.ParseIP("172.30.245.3")) || address.Port < 30000 || address.Port > 30127 {
			t.Fatal("unexpected relay address", relay.LocalAddr())
		}
		if err = client.CreatePermission(&net.UDPAddr{IP: net.ParseIP("169.254.169.254"), Port: 80}); err == nil {
			t.Fatal("restricted metadata peer accepted")
		}
		peer, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("172.30.245.4")})
		if err != nil {
			t.Fatal(err)
		}
		defer peer.Close()
		deadline := time.Now().Add(5 * time.Second)
		if err = peer.SetDeadline(deadline); err != nil {
			t.Fatal(err)
		}
		if err = relay.SetDeadline(deadline); err != nil {
			t.Fatal(err)
		}
		payload := []byte("yapper-turn-relay-" + identity)
		if _, err = relay.WriteTo(payload, peer.LocalAddr()); err != nil {
			t.Fatal("relay send", err)
		}
		buffer := make([]byte, 1024)
		n, source, err := peer.ReadFrom(buffer)
		if err != nil || !bytes.Equal(buffer[:n], payload) {
			t.Fatal("peer did not receive relayed payload", err)
		}
		if _, err = peer.WriteTo(payload, source); err != nil {
			t.Fatal(err)
		}
		n, _, err = relay.ReadFrom(buffer)
		if err != nil || !bytes.Equal(buffer[:n], payload) {
			t.Fatal("relay return path failed", err)
		}
	})
}
