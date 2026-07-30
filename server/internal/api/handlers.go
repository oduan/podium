package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"podium/server/internal/files"
	"podium/server/internal/session"
)

// --- auth ---

func (s *Server) handleAuthVerify(w http.ResponseWriter, _ *http.Request) {
	// Reaching here means the auth middleware accepted the token.
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- sessions ---

// sessionView is the API representation of a session.
type sessionView struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Cwd           string    `json:"cwd"`
	PiSessionFile string    `json:"piSessionFile,omitempty"`
	IsWorkspace   bool      `json:"isWorkspace"`
	CreatedAt     time.Time `json:"createdAt"`
	LastActiveAt  time.Time `json:"lastActiveAt"`
	Running       bool      `json:"running"`
	Pending       bool      `json:"pending"`
}

func (s *Server) handleListSessions(w http.ResponseWriter, _ *http.Request) {
	metas := s.manager.Store().List()
	views := make([]sessionView, 0, len(metas))
	for _, m := range metas {
		views = append(views, sessionView{
			ID: m.ID, Name: m.Name, Cwd: m.Cwd, PiSessionFile: m.PiSessionFile,
			IsWorkspace: m.IsWorkspace, CreatedAt: m.CreatedAt, LastActiveAt: m.LastActiveAt,
			Running: s.manager.IsRunning(m.ID), Pending: m.Pending,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": views})
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Dir  string `json:"dir"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if utf8.RuneCountInString(req.Name) > 256 {
		writeError(w, http.StatusBadRequest, "session name is too long")
		return
	}
	if len(req.Dir) > 32*1024 {
		writeError(w, http.StatusBadRequest, "directory path is too long")
		return
	}
	if req.Dir != "" {
		// The folder picker works with paths under the browse root; reject
		// anything else defensively.
		resolved, err := files.Resolve(s.cfg.AllowedBrowseRoot, relToBrowseRoot(s.cfg.AllowedBrowseRoot, req.Dir))
		if err != nil {
			writeError(w, http.StatusBadRequest, "directory is outside the allowed browse root")
			return
		}
		req.Dir = resolved
	}
	meta, err := s.manager.Create(r.Context(), req.Name, req.Dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sessionView{
		ID: meta.ID, Name: meta.Name, Cwd: meta.Cwd, PiSessionFile: meta.PiSessionFile,
		IsWorkspace: meta.IsWorkspace, CreatedAt: meta.CreatedAt, LastActiveAt: meta.LastActiveAt,
		Running: s.manager.IsRunning(meta.ID), Pending: meta.Pending,
	})
}

func (s *Server) handlePrepareSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.manager.Store().Get(id); !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	var req struct {
		Dir      string `json:"dir"`
		Provider string `json:"provider"`
		ModelID  string `json:"modelId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Dir = strings.TrimSpace(req.Dir)
	req.Provider = strings.TrimSpace(req.Provider)
	req.ModelID = strings.TrimSpace(req.ModelID)
	if len(req.Dir) > 32*1024 {
		writeError(w, http.StatusBadRequest, "directory path is too long")
		return
	}
	if (req.Provider == "") != (req.ModelID == "") || len(req.Provider) > 256 || len(req.ModelID) > 1024 {
		writeError(w, http.StatusBadRequest, "invalid initial model")
		return
	}
	if req.Dir != "" {
		resolved, err := files.Resolve(s.cfg.AllowedBrowseRoot, relToBrowseRoot(s.cfg.AllowedBrowseRoot, req.Dir))
		if err != nil {
			writeError(w, http.StatusBadRequest, "directory is outside the allowed browse root")
			return
		}
		req.Dir = resolved
	}
	meta, err := s.manager.Prepare(id, req.Dir, req.Provider, req.ModelID)
	if err != nil {
		if errors.Is(err, session.ErrSessionAlreadyPrepared) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessionView{
		ID: meta.ID, Name: meta.Name, Cwd: meta.Cwd, PiSessionFile: meta.PiSessionFile,
		IsWorkspace: meta.IsWorkspace, CreatedAt: meta.CreatedAt, LastActiveAt: meta.LastActiveAt,
		Running: s.manager.IsRunning(meta.ID), Pending: meta.Pending,
	})
}

// relToBrowseRoot converts an absolute picked path to a root-relative path;
// returns "invalid" marker string that will fail Resolve when outside.
func relToBrowseRoot(root, abs string) string {
	rootAbs, err1 := filepath.Abs(root)
	pAbs, err2 := filepath.Abs(abs)
	if err1 != nil || err2 != nil {
		return ".."
	}
	rel, err := filepath.Rel(rootAbs, pAbs)
	if err != nil {
		return ".."
	}
	return rel
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, ok := s.manager.Store().Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	view := sessionView{
		ID: meta.ID, Name: meta.Name, Cwd: meta.Cwd, PiSessionFile: meta.PiSessionFile,
		IsWorkspace: meta.IsWorkspace, CreatedAt: meta.CreatedAt, LastActiveAt: meta.LastActiveAt,
		Running: s.manager.IsRunning(id), Pending: meta.Pending,
	}
	out := map[string]any{"session": view}

	// Enrich with live state/stats when the process is running.
	if client, release, ok := s.manager.Borrow(id); ok {
		defer release()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if data, err := client.CallData(ctx, "get_state", nil); err == nil {
			out["state"] = json.RawMessage(data)
		}
		if data, err := client.CallData(ctx, "get_session_stats", nil); err == nil {
			out["stats"] = json.RawMessage(data)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.manager.Store().Get(id); !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	purge := r.URL.Query().Get("purge") == "true"
	if err := s.manager.Delete(id, purge); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetEntries(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	client, release, err := s.manager.Acquire(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer release()
	fields := map[string]any{}
	if since := r.URL.Query().Get("since"); since != "" {
		fields["since"] = since
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	data, err := client.CallData(ctx, "get_entries", fields)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if err := s.manager.Touch(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeRaw(w, http.StatusOK, data)
}

// --- files ---

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, ok := s.manager.Store().Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if meta.Pending || meta.Cwd == "" {
		writeError(w, http.StatusConflict, "session has not selected a working directory")
		return
	}
	entries, err := files.List(meta.Cwd, r.URL.Query().Get("path"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, files.ErrOutsideRoot) {
			status = http.StatusBadRequest
		} else if errors.Is(err, files.ErrDirectoryTooLarge) {
			status = http.StatusRequestEntityTooLarge
		} else if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) handleReadFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, ok := s.manager.Store().Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if meta.Pending || meta.Cwd == "" {
		writeError(w, http.StatusConflict, "session has not selected a working directory")
		return
	}
	fc, err := files.Read(meta.Cwd, r.URL.Query().Get("path"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, files.ErrOutsideRoot) {
			status = http.StatusBadRequest
		} else if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, fc)
}

// handleBrowseDirs lists directories under the allowed browse root for the
// "open folder" picker. Returns absolute paths for display.
func (s *Server) handleBrowseDirs(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	entries, err := files.List(s.cfg.AllowedBrowseRoot, rel)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, files.ErrOutsideRoot) {
			status = http.StatusBadRequest
		} else if errors.Is(err, files.ErrDirectoryTooLarge) {
			status = http.StatusRequestEntityTooLarge
		} else if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	dirs := entries[:0]
	for _, e := range entries {
		if e.IsDir && !strings.HasPrefix(e.Name, ".") {
			dirs = append(dirs, e)
		}
	}
	abs, err := files.Resolve(s.cfg.AllowedBrowseRoot, rel)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"root":    s.cfg.AllowedBrowseRoot,
		"path":    rel,
		"abs":     abs,
		"entries": dirs,
	})
}

// --- models ---

func (s *Server) handleGetModels(w http.ResponseWriter, r *http.Request) {
	client, release, err := s.manager.StartEphemeral()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	defer release()
	s.callModelCommand(w, r, client, "get_available_models")
}

func (s *Server) handleGetSessionModels(w http.ResponseWriter, r *http.Request) {
	s.callSessionCommand(w, r, "get_available_models")
}

func (s *Server) handleGetThinkingLevels(w http.ResponseWriter, r *http.Request) {
	s.callSessionCommand(w, r, "get_available_thinking_levels")
}

func (s *Server) callSessionCommand(w http.ResponseWriter, r *http.Request, command string) {
	client, release, err := s.manager.Acquire(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	defer release()
	s.callModelCommand(w, r, client, command)
}

type rpcCaller interface {
	CallData(context.Context, string, map[string]any) (json.RawMessage, error)
}

func (s *Server) callModelCommand(w http.ResponseWriter, r *http.Request, client rpcCaller, command string) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	data, err := client.CallData(ctx, command, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeRaw(w, http.StatusOK, data)
}

// --- keys ---

func (s *Server) handleGetKeys(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"keys": s.keys.ListMasked()})
}

func (s *Server) handlePutKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"` // empty removes the key
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.keys.Set(req.Provider, req.Key); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Note: keys are injected at process spawn; running sessions keep their
	// previous environment until restarted.
	writeJSON(w, http.StatusOK, map[string]any{"keys": s.keys.ListMasked()})
}
