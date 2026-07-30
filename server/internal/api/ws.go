package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	// Token auth already ran in middleware; Origin checks are not useful for
	// a token-protected same-origin SPA behind a reverse proxy.
	CheckOrigin: func(*http.Request) bool { return true },
}

const (
	maxWebSocketMessage = 24 * 1024 * 1024
	maxInflightCommands = 32
)

// wsCommand is a message from the browser. Passthrough commands carry the
// client's own id which is preserved in the response we send back.
type wsCommand struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// passthroughCommands are RPC command types the browser may invoke directly.
var passthroughCommands = map[string]bool{
	"prompt":                        true,
	"steer":                         true,
	"follow_up":                     true,
	"abort":                         true,
	"abort_retry":                   true,
	"set_model":                     true,
	"set_thinking_level":            true,
	"get_available_thinking_levels": true,
	"get_available_models":          true,
	"set_session_name":              true,
	"get_state":                     true,
	"get_messages":                  true,
	"get_entries":                   true,
	"get_session_stats":             true,
	"get_commands":                  true,
	"get_fork_messages":             true,
	"compact":                       true,
	"set_auto_compaction":           true,
	"set_auto_retry":                true,
	"set_steering_mode":             true,
	"set_follow_up_mode":            true,
}

// handleWebSocket bridges one browser connection to the session's pi process:
// events stream down, commands are forwarded up.
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.manager.Store().Get(id); !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxWebSocketMessage)

	var writeMu sync.Mutex
	send := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
		return conn.WriteJSON(v)
	}
	sendRaw := func(raw json.RawMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
		return conn.WriteMessage(websocket.TextMessage, raw)
	}

	// Ensure the pi process is running (lazy start / resume).
	client, release, err := s.manager.Acquire(r.Context(), id)
	if err != nil {
		_ = send(map[string]any{"type": "process_status", "status": "error", "error": err.Error()})
		return
	}
	defer release()
	commandCtx, cancelCommands := context.WithCancel(context.Background())
	var commandWG sync.WaitGroup
	defer commandWG.Wait()
	defer cancelCommands()

	_ = send(map[string]any{"type": "process_status", "status": "running"})

	// Stream pi events to the browser.
	events, cancelSub := client.Subscribe()
	defer cancelSub()
	streamDone := make(chan struct{})
	go func() {
		defer close(streamDone)
		for raw := range events {
			if sendRaw(raw) != nil {
				return
			}
		}
		if client.Alive() {
			_ = send(map[string]any{"type": "process_status", "status": "error", "error": "event consumer is too slow; reconnect to resync"})
		} else {
			_ = send(map[string]any{"type": "process_status", "status": "stopped"})
		}
		_ = conn.Close()
	}()

	// Keepalive pings so proxies don't drop the connection.
	pingStop := make(chan struct{})
	defer close(pingStop)
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pingStop:
				return
			case <-ticker.C:
				writeMu.Lock()
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				err := conn.WriteMessage(websocket.PingMessage, nil)
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))

	// Bound concurrent long-running RPC calls from one browser connection.
	inflight := make(chan struct{}, maxInflightCommands)
	// Read browser commands until the connection closes.
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		var cmd wsCommand
		if err := json.Unmarshal(data, &cmd); err != nil {
			_ = send(map[string]any{"type": "response", "command": "parse", "success": false, "error": "invalid JSON"})
			continue
		}
		if cmd.Type == "" || len(cmd.Type) > 64 || len(cmd.ID) > 256 {
			_ = send(map[string]any{"type": "response", "command": cmd.Type, "id": cmd.ID, "success": false, "error": "invalid command envelope"})
			continue
		}

		switch {
		case cmd.Type == "extension_ui_response":
			// Fire-and-forget passthrough back to pi (no response expected).
			var raw map[string]any
			if json.Unmarshal(data, &raw) == nil {
				if err := validateExtensionResponse(raw); err != nil {
					_ = send(map[string]any{"type": "response", "command": cmd.Type, "id": cmd.ID, "success": false, "error": err.Error()})
					continue
				}
				if err := client.SendRaw(raw); err != nil {
					log.Printf("session %s: forward extension_ui_response: %v", id, err)
				}
			}
		case cmd.Type == "ping":
			_ = send(map[string]any{"type": "pong"})
		case passthroughCommands[cmd.Type]:
			var fields map[string]any
			if err := json.Unmarshal(data, &fields); err != nil {
				continue
			}
			delete(fields, "id")
			delete(fields, "type")
			if err := validateCommand(cmd.Type, fields); err != nil {
				_ = send(map[string]any{
					"type": "response", "command": cmd.Type, "id": cmd.ID,
					"success": false, "error": err.Error(),
				})
				continue
			}
			select {
			case inflight <- struct{}{}:
			default:
				_ = send(map[string]any{
					"type": "response", "command": cmd.Type, "id": cmd.ID,
					"success": false, "error": "too many in-flight commands",
				})
				continue
			}
			commandWG.Add(1)
			go func(cmdType, clientID string, fields map[string]any) {
				defer commandWG.Done()
				defer func() { <-inflight }()
				ctx, cancel := context.WithTimeout(commandCtx, 5*time.Minute)
				defer cancel()
				resp, err := client.Call(ctx, cmdType, fields)
				out := map[string]any{
					"type":    "response",
					"command": cmdType,
					"success": resp.Success,
				}
				if clientID != "" {
					out["id"] = clientID
				}
				if err != nil {
					out["success"] = false
					out["error"] = err.Error()
				} else {
					if len(resp.Data) > 0 {
						out["data"] = json.RawMessage(resp.Data)
					}
					if resp.Error != "" {
						out["error"] = resp.Error
					}
				}
				_ = send(out)
				if err := s.manager.Touch(id); err != nil {
					log.Printf("session %s: persist activity: %v", id, err)
				}
				// Keep metadata fresh after commands that may change it.
				if err == nil && resp.Success && (cmdType == "prompt" || cmdType == "set_session_name") {
					if err := s.manager.RefreshMeta(context.Background(), id); err != nil {
						log.Printf("session %s: refresh metadata: %v", id, err)
					}
				}
			}(cmd.Type, cmd.ID, fields)
		default:
			_ = send(map[string]any{
				"type": "response", "command": cmd.Type, "id": cmd.ID,
				"success": false, "error": "command not allowed",
			})
		}
	}
}

func validateCommand(command string, fields map[string]any) error {
	const maxTextBytes = 256 * 1024
	if command == "prompt" || command == "steer" || command == "follow_up" {
		message, ok := fields["message"].(string)
		if !ok {
			return errors.New("message must be a string")
		}
		if len(message) > maxTextBytes {
			return errors.New("message is larger than 256 KiB")
		}
		if rawImages, exists := fields["images"]; exists {
			images, ok := rawImages.([]any)
			if !ok || len(images) > 4 {
				return errors.New("images must contain at most four items")
			}
			maxOne := base64.StdEncoding.EncodedLen(8 * 1024 * 1024)
			maxTotal := base64.StdEncoding.EncodedLen(16 * 1024 * 1024)
			total := 0
			for _, rawImage := range images {
				image, ok := rawImage.(map[string]any)
				if !ok || image["type"] != "image" {
					return errors.New("image has an invalid type")
				}
				data, dataOK := image["data"].(string)
				mime, mimeOK := image["mimeType"].(string)
				if !dataOK || data == "" || !mimeOK || len(mime) > 128 || len(mime) < 6 || mime[:6] != "image/" {
					return errors.New("image has invalid data or mimeType")
				}
				if len(data) > maxOne {
					return errors.New("an image exceeds the 8 MiB limit")
				}
				total += len(data)
				if total > maxTotal {
					return errors.New("images exceed the 16 MiB total limit")
				}
			}
		}
	}
	if command == "set_session_name" {
		name, ok := fields["name"].(string)
		if !ok || len(name) > 1024 {
			return errors.New("invalid session name")
		}
	}
	if command == "set_model" {
		provider, providerOK := fields["provider"].(string)
		model, modelOK := fields["modelId"].(string)
		if !providerOK || !modelOK || provider == "" || model == "" || len(provider) > 256 || len(model) > 1024 {
			return errors.New("invalid provider or model id")
		}
	}
	if command == "set_thinking_level" {
		level, ok := fields["level"].(string)
		if !ok || level == "" || len(level) > 32 {
			return errors.New("invalid thinking level")
		}
	}
	if instructions, ok := fields["customInstructions"].(string); ok && len(instructions) > maxTextBytes {
		return errors.New("custom instructions are larger than 256 KiB")
	}
	return nil
}

func validateExtensionResponse(response map[string]any) error {
	id, ok := response["id"].(string)
	if !ok || id == "" || len(id) > 256 {
		return errors.New("invalid extension response id")
	}
	fields := 0
	if cancelled, exists := response["cancelled"]; exists {
		value, ok := cancelled.(bool)
		if !ok || !value {
			return errors.New("cancelled must be true")
		}
		fields++
	}
	if _, exists := response["confirmed"]; exists {
		if _, ok := response["confirmed"].(bool); !ok {
			return errors.New("confirmed must be a boolean")
		}
		fields++
	}
	if value, exists := response["value"]; exists {
		text, ok := value.(string)
		if !ok || len(text) > 256*1024 {
			return errors.New("value must be a string no larger than 256 KiB")
		}
		fields++
	}
	if fields != 1 {
		return fmt.Errorf("extension response must contain exactly one result field")
	}
	return nil
}
