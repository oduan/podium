// Package auth provides bearer-token authentication middleware with
// constant-time comparison and per-IP failure rate limiting.
package auth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxFailures   = 10
	failureWindow = time.Minute
	maxTrackedIPs = 10_000
)

// Authenticator validates requests against a single shared token.
type Authenticator struct {
	token []byte

	mu          sync.Mutex
	failures    map[string][]time.Time
	lastCleanup time.Time
}

func New(token string) *Authenticator {
	return &Authenticator{
		token:    []byte(token),
		failures: make(map[string][]time.Time),
	}
}

// Check returns true if the request carries a valid token via the
// Authorization header ("Bearer <token>") or, for a WebSocket upgrade only,
// the "token" query parameter (browser WebSocket clients cannot set headers).
func (a *Authenticator) Check(r *http.Request) bool {
	ip := clientIP(r)
	candidate := ""
	if parts := strings.Fields(r.Header.Get("Authorization")); len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		candidate = parts[1]
	} else if isWebSocketUpgrade(r) {
		q := r.URL.Query().Get("token")
		candidate = q
	}
	if candidate != "" && subtle.ConstantTimeCompare([]byte(candidate), a.token) == 1 {
		a.clearFailures(ip)
		return true
	}
	if a.isRateLimited(ip) {
		return false
	}
	a.recordFailure(ip)
	return false
}

// Middleware wraps an http.Handler and rejects unauthenticated requests.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.Check(r) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Authenticator) isRateLimited(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-failureWindow)
	recent := a.failures[ip][:0]
	for _, t := range a.failures[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) == 0 {
		delete(a.failures, ip)
	} else {
		a.failures[ip] = recent
	}
	if a.lastCleanup.IsZero() || now.Sub(a.lastCleanup) >= failureWindow {
		for candidate, failures := range a.failures {
			kept := failures[:0]
			for _, t := range failures {
				if t.After(cutoff) {
					kept = append(kept, t)
				}
			}
			if len(kept) == 0 {
				delete(a.failures, candidate)
			} else {
				a.failures[candidate] = kept
			}
		}
		a.lastCleanup = now
	}
	return len(recent) >= maxFailures
}

func (a *Authenticator) recordFailure(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, tracked := a.failures[ip]; !tracked && len(a.failures) >= maxTrackedIPs {
		return
	}
	a.failures[ip] = append(a.failures[ip], time.Now())
}

func (a *Authenticator) clearFailures(ip string) {
	a.mu.Lock()
	delete(a.failures, ip)
	a.mu.Unlock()
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote := net.ParseIP(host)
	// Only a local reverse proxy is trusted to supply the original address.
	if remote != nil && remote.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			if forwarded := net.ParseIP(strings.TrimSpace(xff)); forwarded != nil {
				return forwarded.String()
			}
		}
	}
	if remote != nil {
		return remote.String()
	}
	return host
}
