package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAHandler(t *testing.T) {
	t.Parallel()

	assets := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte(`<div id="root"></div>`)},
		"assets/app.js": &fstest.MapFile{Data: []byte(`console.log("podium")`)},
	}
	handler := spaHandler(assets)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
		wantCache  string
		wantAllow  string
	}{
		{
			name:       "root serves index",
			method:     http.MethodGet,
			path:       "/",
			wantStatus: http.StatusOK,
			wantBody:   `id="root"`,
			wantCache:  "no-cache",
		},
		{
			name:       "client route falls back to index",
			method:     http.MethodGet,
			path:       "/sessions/example",
			wantStatus: http.StatusOK,
			wantBody:   `id="root"`,
			wantCache:  "no-cache",
		},
		{
			name:       "hashed asset is immutable",
			method:     http.MethodGet,
			path:       "/assets/app.js",
			wantStatus: http.StatusOK,
			wantBody:   "podium",
			wantCache:  "public, max-age=31536000, immutable",
		},
		{
			name:       "missing file is not an SPA route",
			method:     http.MethodGet,
			path:       "/assets/missing.js",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "write method is rejected",
			method:     http.MethodPost,
			path:       "/",
			wantStatus: http.StatusMethodNotAllowed,
			wantAllow:  "GET, HEAD",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)

			if res.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", res.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && !strings.Contains(res.Body.String(), tt.wantBody) {
				t.Fatalf("body %q does not contain %q", res.Body.String(), tt.wantBody)
			}
			if got := res.Header().Get("Cache-Control"); got != tt.wantCache {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.wantCache)
			}
			if got := res.Header().Get("Allow"); got != tt.wantAllow {
				t.Fatalf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
