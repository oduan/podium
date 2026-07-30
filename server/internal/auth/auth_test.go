package auth

import (
	"net/http/httptest"
	"testing"
)

func TestValidTokenIsNotLockedOutByFailures(t *testing.T) {
	authenticator := New("secret")
	for i := 0; i < maxFailures; i++ {
		req := httptest.NewRequest("GET", "http://podium.test/api/sessions", nil)
		req.RemoteAddr = "203.0.113.10:1234"
		if authenticator.Check(req) {
			t.Fatal("request without a token was accepted")
		}
	}
	req := httptest.NewRequest("GET", "http://podium.test/api/sessions", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	req.Header.Set("Authorization", "Bearer secret")
	if !authenticator.Check(req) {
		t.Fatal("valid token was rejected after prior failures")
	}
}

func TestQueryTokenOnlyAcceptedForWebSocketUpgrade(t *testing.T) {
	authenticator := New("secret")
	req := httptest.NewRequest("GET", "http://podium.test/api/sessions?token=secret", nil)
	if authenticator.Check(req) {
		t.Fatal("query token was accepted for an ordinary HTTP request")
	}
	req = httptest.NewRequest("GET", "http://podium.test/api/sessions/one/ws?token=secret", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	if !authenticator.Check(req) {
		t.Fatal("query token was rejected for a WebSocket upgrade")
	}
}

func TestClientIPOnlyTrustsLocalProxy(t *testing.T) {
	direct := httptest.NewRequest("GET", "http://podium.test", nil)
	direct.RemoteAddr = "203.0.113.4:443"
	direct.Header.Set("X-Forwarded-For", "198.51.100.8")
	if got := clientIP(direct); got != "203.0.113.4" {
		t.Fatalf("untrusted X-Forwarded-For produced %q", got)
	}
	proxied := httptest.NewRequest("GET", "http://podium.test", nil)
	proxied.RemoteAddr = "127.0.0.1:5000"
	proxied.Header.Set("X-Forwarded-For", "198.51.100.8, 127.0.0.1")
	if got := clientIP(proxied); got != "198.51.100.8" {
		t.Fatalf("trusted proxy address produced %q", got)
	}
}
