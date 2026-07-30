package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"podium/server/internal/auth"
	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/session"
)

func TestEndToEndWithStubPi(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required for the pi RPC stub")
	}
	projectRoot, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	stubName := "stub-pi.sh"
	if runtime.GOOS == "windows" {
		stubName = "stub-pi.cmd"
	}
	stub, err := filepath.Abs(filepath.Join("..", "..", "testdata", stubName))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(stub, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	dataDir := t.TempDir()
	cfg := &config.Config{
		Token: "test-token", DataDir: dataDir, WorkspacesRoot: t.TempDir(),
		AllowedBrowseRoot: projectRoot, PiBinary: stub, MaxProcesses: 2,
		IdleTimeoutMinutes: 1,
	}
	store, err := session.NewStore(filepath.Join(dataDir, "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	keyStore, err := keys.NewStore(filepath.Join(dataDir, "keys.json"))
	if err != nil {
		t.Fatal(err)
	}
	manager := session.NewManager(cfg, store, keyStore)
	defer manager.Shutdown()
	httpServer := httptest.NewServer(NewServer(cfg, auth.New(cfg.Token), manager, keyStore).Handler())
	defer httpServer.Close()

	pending := requestJSON[sessionView](t, httpServer.URL+"/api/sessions", http.MethodPost, cfg.Token, map[string]any{})
	if pending.ID == "" || !pending.Pending || pending.Cwd != "" || pending.Running {
		t.Fatalf("unexpected pending session: %+v", pending)
	}
	prepared := requestJSON[sessionView](t, httpServer.URL+"/api/sessions/"+pending.ID, http.MethodPatch, cfg.Token, map[string]any{
		"dir": projectRoot,
	})
	if prepared.Pending || prepared.Cwd != projectRoot || prepared.Running {
		t.Fatalf("unexpected prepared session: %+v", prepared)
	}
	requestJSON[struct {
		OK bool `json:"ok"`
	}](t, httpServer.URL+"/api/sessions/"+pending.ID, http.MethodDelete, cfg.Token, nil)

	created := requestJSON[sessionView](t, httpServer.URL+"/api/sessions", http.MethodPost, cfg.Token, map[string]any{
		"name": "Smoke", "dir": projectRoot,
	})
	if created.ID == "" || !created.Running {
		t.Fatalf("unexpected created session: %+v", created)
	}

	models := requestJSON[struct {
		Models []any `json:"models"`
	}](t, httpServer.URL+"/api/models", http.MethodGet, cfg.Token, nil)
	sessionModels := requestJSON[struct {
		Models []any `json:"models"`
	}](t, httpServer.URL+"/api/sessions/"+created.ID+"/models", http.MethodGet, cfg.Token, nil)
	levels := requestJSON[struct {
		Levels []string `json:"levels"`
	}](t, httpServer.URL+"/api/sessions/"+created.ID+"/thinking-levels", http.MethodGet, cfg.Token, nil)
	file := requestJSON[struct {
		Binary  bool   `json:"binary"`
		Content string `json:"content"`
	}](t, httpServer.URL+"/api/sessions/"+created.ID+"/file?path=README.md", http.MethodGet, cfg.Token, nil)
	if len(models.Models) == 0 || len(sessionModels.Models) == 0 || len(levels.Levels) == 0 || file.Binary || !strings.Contains(file.Content, "Podium") {
		t.Fatal("model, thinking-level, or file REST smoke check failed")
	}

	wsURL, _ := url.Parse(httpServer.URL)
	wsURL.Scheme = "ws"
	wsURL.Path = "/api/sessions/" + created.ID + "/ws"
	wsURL.RawQuery = "token=" + url.QueryEscape(cfg.Token)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]any{"id": "prompt-1", "type": "prompt", "message": "hello"}); err != nil {
		t.Fatal(err)
	}
	sawResponse, sawEcho, sawSettled := false, false, false
	for !(sawResponse && sawEcho && sawSettled) {
		var event map[string]any
		if err := conn.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		switch event["type"] {
		case "response":
			sawResponse = event["id"] == "prompt-1" && event["success"] == true
		case "message_end":
			message, _ := event["message"].(map[string]any)
			content, _ := message["content"].([]any)
			if len(content) > 0 {
				block, _ := content[0].(map[string]any)
				sawEcho = block["text"] == "Echo: hello"
			}
		case "agent_settled":
			sawSettled = true
		}
	}
	_ = conn.Close()

	entries := requestJSON[struct {
		Entries []any  `json:"entries"`
		LeafID  string `json:"leafId"`
	}](t, httpServer.URL+"/api/sessions/"+created.ID+"/entries", http.MethodGet, cfg.Token, nil)
	if len(entries.Entries) != 2 || entries.LeafID == "" {
		t.Fatalf("durable history smoke check failed: %+v", entries)
	}
	requestJSON[map[string]bool](t, httpServer.URL+"/api/sessions/"+created.ID, http.MethodDelete, cfg.Token, nil)
	if _, ok := store.Get(created.ID); ok {
		t.Fatal("deleted session remains in the store")
	}
}

func requestJSON[T any](t *testing.T, endpoint, method, token string, body any) T {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, endpoint, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s %s: status %d: %s", method, endpoint, resp.StatusCode, data)
	}
	var result T
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(fmt.Errorf("decode %s: %w", endpoint, err))
	}
	return result
}
