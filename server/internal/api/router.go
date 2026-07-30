// Package api wires the REST and WebSocket endpoints.
package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"podium/server/internal/auth"
	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/session"
	"podium/server/internal/webui"
)

// Server bundles handler dependencies.
type Server struct {
	cfg     *config.Config
	authn   *auth.Authenticator
	manager *session.Manager
	keys    *keys.Store
}

func NewServer(cfg *config.Config, authn *auth.Authenticator, mgr *session.Manager, keyStore *keys.Store) *Server {
	return &Server{cfg: cfg, authn: authn, manager: mgr, keys: keyStore}
}

// Handler builds the full HTTP handler: /api/* (authenticated) plus static
// SPA assets.
func (s *Server) Handler() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("POST /api/auth/verify", s.handleAuthVerify)
	api.HandleFunc("GET /api/sessions", s.handleListSessions)
	api.HandleFunc("POST /api/sessions", s.handleCreateSession)
	api.HandleFunc("GET /api/sessions/{id}", s.handleGetSession)
	api.HandleFunc("PATCH /api/sessions/{id}", s.handlePrepareSession)
	api.HandleFunc("DELETE /api/sessions/{id}", s.handleDeleteSession)
	api.HandleFunc("GET /api/sessions/{id}/entries", s.handleGetEntries)
	api.HandleFunc("GET /api/sessions/{id}/models", s.handleGetSessionModels)
	api.HandleFunc("GET /api/sessions/{id}/thinking-levels", s.handleGetThinkingLevels)
	api.HandleFunc("GET /api/sessions/{id}/files", s.handleListFiles)
	api.HandleFunc("GET /api/sessions/{id}/file", s.handleReadFile)
	api.HandleFunc("GET /api/sessions/{id}/ws", s.handleWebSocket)
	api.HandleFunc("GET /api/dirs", s.handleBrowseDirs)
	api.HandleFunc("GET /api/models", s.handleGetModels)
	api.HandleFunc("GET /api/settings/keys", s.handleGetKeys)
	api.HandleFunc("PUT /api/settings/keys", s.handlePutKeys)

	root := http.NewServeMux()
	root.Handle("/api/", limitRequestBody(s.authn.Middleware(api)))
	root.Handle("/", s.staticHandler())
	return securityHeaders(root)
}

func limitRequestBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodySize)
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

// staticHandler serves the embedded SPA, unless an external directory was
// explicitly configured as an override.
func (s *Server) staticHandler() http.Handler {
	assets := webui.Assets()
	if s.cfg.StaticDir != "" {
		assets = os.DirFS(s.cfg.StaticDir)
	}
	return spaHandler(assets)
}

// spaHandler serves files from assets and falls back to index.html for
// extensionless client-side routes.
func spaHandler(assets fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}

		if info, err := fs.Stat(assets, name); err == nil && !info.IsDir() {
			serveAsset(fileServer, w, r, name)
			return
		}

		// Missing files should be real 404s; only application routes receive
		// the SPA shell.
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		serveAsset(fileServer, w, r, "index.html")
	})
}

func serveAsset(fileServer http.Handler, w http.ResponseWriter, r *http.Request, name string) {
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}

	req := r.Clone(r.Context())
	requestURL := *r.URL
	if name == "index.html" {
		// FileServer redirects explicit /index.html requests. Serving the root
		// lets it resolve index.html without turning SPA fallbacks into 301s.
		requestURL.Path = "/"
	} else {
		requestURL.Path = "/" + name
	}
	req.URL = &requestURL
	fileServer.ServeHTTP(w, req)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeRaw(w http.ResponseWriter, status int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if len(raw) == 0 {
		_, _ = w.Write([]byte("null"))
		return
	}
	_, _ = w.Write(raw)
}

const maxJSONBodySize = 1 * 1024 * 1024

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodySize)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "JSON body must contain exactly one value")
		return false
	}
	return true
}
