package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/pirpc"
)

// runtime tracks a live pi subprocess and the callers currently borrowing it.
type runtime struct {
	client   *pirpc.Client
	refs     int
	lastUsed time.Time
}

// ErrSessionAlreadyPrepared is returned when callers try to change the
// working directory after a pending session has been initialized.
var ErrSessionAlreadyPrepared = errors.New("session has already been started")

// Manager owns session metadata plus pi subprocess lifecycle: lazy start,
// resume, admission control, idle reaping, and shutdown.
type Manager struct {
	cfg   *config.Config
	store *Store
	keys  *keys.Store

	// startMu serializes process admission, start, stop, and deletion. It keeps
	// duplicate Ensure calls from launching two processes for the same session.
	startMu sync.Mutex
	mu      sync.Mutex
	running map[string]*runtime
	eph     map[*pirpc.Client]struct{}
	closing bool

	stopReaper   chan struct{}
	shutdownOnce sync.Once
}

func NewManager(cfg *config.Config, store *Store, keyStore *keys.Store) *Manager {
	m := &Manager{
		cfg:        cfg,
		store:      store,
		keys:       keyStore,
		running:    map[string]*runtime{},
		eph:        map[*pirpc.Client]struct{}{},
		stopReaper: make(chan struct{}),
	}
	go m.reapLoop()
	return m
}

// Store exposes the metadata store.
func (m *Manager) Store() *Store { return m.store }

// Create registers a session. When dir is empty it remains pending until the
// first prompt chooses a directory; callers that provide a directory retain
// the existing eager-start behavior.
func (m *Manager) Create(ctx context.Context, name, dir string) (Meta, error) {
	id, err := NewID()
	if err != nil {
		return Meta{}, fmt.Errorf("generate session id: %w", err)
	}
	if dir == "" {
		now := time.Now()
		meta := Meta{
			ID:           id,
			Name:         name,
			Pending:      true,
			CreatedAt:    now,
			LastActiveAt: now,
		}
		if err := m.store.Put(meta); err != nil {
			return Meta{}, err
		}
		return meta, nil
	}

	info, err := os.Stat(dir)
	if err != nil {
		return Meta{}, fmt.Errorf("directory not accessible: %w", err)
	}
	if !info.IsDir() {
		return Meta{}, errors.New("path is not a directory")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return Meta{}, err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		return Meta{}, err
	}
	now := time.Now()
	meta := Meta{
		ID:           id,
		Name:         name,
		Cwd:          abs,
		CreatedAt:    now,
		LastActiveAt: now,
	}
	if err := m.store.Put(meta); err != nil {
		return Meta{}, err
	}

	rollback := func(cause error) (Meta, error) {
		cleanupErr := m.Delete(id, true)
		if cleanupErr != nil {
			return Meta{}, errors.Join(cause, fmt.Errorf("rollback session: %w", cleanupErr))
		}
		return Meta{}, cause
	}
	client, release, err := m.Acquire(ctx, id)
	if err != nil {
		return rollback(err)
	}
	defer release()
	if name != "" {
		cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, err = client.CallData(cctx, "set_session_name", map[string]any{"name": name})
		cancel()
		if err != nil {
			return rollback(fmt.Errorf("set session name: %w", err))
		}
		if err := m.refreshMeta(ctx, id, client); err != nil {
			return rollback(err)
		}
	}
	meta, ok := m.store.Get(id)
	if !ok {
		return rollback(errors.New("session metadata disappeared during creation"))
	}
	return meta, nil
}

// Prepare assigns a pending session's final working directory and remembers
// the model that must be selected before its first prompt.
func (m *Manager) Prepare(id, dir, modelProvider, modelID string) (Meta, error) {
	m.startMu.Lock()
	defer m.startMu.Unlock()

	meta, ok := m.store.Get(id)
	if !ok {
		return Meta{}, errors.New("session not found")
	}
	if !meta.Pending {
		return Meta{}, ErrSessionAlreadyPrepared
	}

	isWorkspace := dir == ""
	if isWorkspace {
		dir = filepath.Join(m.cfg.WorkspacesRoot, id)
		if err := os.Mkdir(dir, 0o700); err != nil {
			return Meta{}, fmt.Errorf("create workspace dir: %w", err)
		}
	} else {
		info, err := os.Stat(dir)
		if err != nil {
			return Meta{}, fmt.Errorf("directory not accessible: %w", err)
		}
		if !info.IsDir() {
			return Meta{}, errors.New("path is not a directory")
		}
	}

	cleanupWorkspace := func() {
		if isWorkspace {
			_ = os.Remove(dir)
		}
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		cleanupWorkspace()
		return Meta{}, err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		cleanupWorkspace()
		return Meta{}, err
	}

	if err := m.store.Update(id, func(item *Meta) {
		item.Cwd = abs
		item.IsWorkspace = isWorkspace
		item.Pending = false
		item.InitialModelProvider = modelProvider
		item.InitialModelID = modelID
		item.LastActiveAt = time.Now()
	}); err != nil {
		cleanupWorkspace()
		return Meta{}, err
	}
	prepared, ok := m.store.Get(id)
	if !ok {
		cleanupWorkspace()
		return Meta{}, errors.New("session metadata disappeared during preparation")
	}
	return prepared, nil
}

// Acquire returns a live client and pins it against idle eviction until the
// returned release function is called.
func (m *Manager) Acquire(ctx context.Context, id string) (*pirpc.Client, func(), error) {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	client, err := m.ensureLocked(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	rt, ok := m.running[id]
	if !ok || rt.client != client || !client.Alive() {
		m.mu.Unlock()
		return nil, nil, errors.New("pi process exited during startup")
	}
	rt.refs++
	rt.lastUsed = time.Now()
	m.mu.Unlock()

	var once sync.Once
	release := func() {
		once.Do(func() {
			m.mu.Lock()
			if current, ok := m.running[id]; ok && current.client == client {
				if current.refs > 0 {
					current.refs--
				}
				current.lastUsed = time.Now()
			}
			m.mu.Unlock()
		})
	}
	return client, release, nil
}

// Borrow pins an already-running client without starting a new process.
func (m *Manager) Borrow(id string) (*pirpc.Client, func(), bool) {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	m.mu.Lock()
	rt, ok := m.running[id]
	if !ok || !rt.client.Alive() || m.closing {
		m.mu.Unlock()
		return nil, nil, false
	}
	rt.refs++
	rt.lastUsed = time.Now()
	client := rt.client
	m.mu.Unlock()
	var once sync.Once
	return client, func() {
		once.Do(func() {
			m.mu.Lock()
			if current, ok := m.running[id]; ok && current.client == client {
				if current.refs > 0 {
					current.refs--
				}
				current.lastUsed = time.Now()
			}
			m.mu.Unlock()
		})
	}, true
}

// ensureLocked returns or starts a process. Caller holds startMu.
func (m *Manager) ensureLocked(ctx context.Context, id string) (*pirpc.Client, error) {
	meta, ok := m.store.Get(id)
	if !ok {
		return nil, errors.New("session not found")
	}
	if meta.Pending || meta.Cwd == "" {
		return nil, errors.New("session is waiting for a working directory")
	}
	m.mu.Lock()
	if m.closing {
		m.mu.Unlock()
		return nil, errors.New("server is shutting down")
	}
	if rt, ok := m.running[id]; ok && rt.client.Alive() {
		rt.lastUsed = time.Now()
		client := rt.client
		m.mu.Unlock()
		return client, nil
	}
	delete(m.running, id)
	m.mu.Unlock()

	if err := m.reserveProcessSlotLocked(); err != nil {
		return nil, err
	}
	client, err := pirpc.Start(pirpc.Options{
		PiBinary: m.cfg.PiBinary,
		Cwd:      meta.Cwd,
		ExtraEnv: m.keys.Env(),
	})
	if err != nil {
		return nil, err
	}
	failed := true
	defer func() {
		if failed {
			client.Stop()
		}
	}()

	if meta.PiSessionFile != "" {
		if _, statErr := os.Stat(meta.PiSessionFile); statErr == nil {
			cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			data, callErr := client.CallData(cctx, "switch_session", map[string]any{"sessionPath": meta.PiSessionFile})
			cancel()
			if callErr != nil {
				return nil, fmt.Errorf("resume pi session: %w", callErr)
			}
			var result struct {
				Cancelled bool `json:"cancelled"`
			}
			if err := json.Unmarshal(data, &result); err != nil {
				return nil, fmt.Errorf("parse resume result: %w", err)
			}
			if result.Cancelled {
				return nil, errors.New("resume pi session was cancelled")
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return nil, fmt.Errorf("inspect pi session file: %w", statErr)
		}
	}
	if meta.PiSessionFile == "" && meta.InitialModelProvider != "" && meta.InitialModelID != "" {
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		_, callErr := client.CallData(cctx, "set_model", map[string]any{
			"provider": meta.InitialModelProvider,
			"modelId":  meta.InitialModelID,
		})
		cancel()
		if callErr != nil {
			return nil, fmt.Errorf("select initial model: %w", callErr)
		}
	}
	if err := m.refreshMeta(ctx, id, client); err != nil {
		return nil, err
	}

	m.mu.Lock()
	if m.closing {
		m.mu.Unlock()
		return nil, errors.New("server is shutting down")
	}
	m.running[id] = &runtime{client: client, lastUsed: time.Now()}
	m.mu.Unlock()
	failed = false

	go func() {
		<-client.Done()
		m.mu.Lock()
		if rt, ok := m.running[id]; ok && rt.client == client {
			delete(m.running, id)
		}
		m.mu.Unlock()
	}()
	return client, nil
}

// reserveProcessSlotLocked evicts one unborrowed LRU process when at capacity.
// Caller holds startMu.
func (m *Manager) reserveProcessSlotLocked() error {
	m.mu.Lock()
	for id, rt := range m.running {
		if !rt.client.Alive() {
			delete(m.running, id)
		}
	}
	for client := range m.eph {
		if !client.Alive() {
			delete(m.eph, client)
		}
	}
	if len(m.running)+len(m.eph) < m.cfg.MaxProcesses {
		m.mu.Unlock()
		return nil
	}
	type candidate struct {
		id       string
		rt       *runtime
		lastUsed time.Time
	}
	candidates := make([]candidate, 0, len(m.running))
	for id, rt := range m.running {
		if rt.refs == 0 {
			candidates = append(candidates, candidate{id: id, rt: rt, lastUsed: rt.lastUsed})
		}
	}
	m.mu.Unlock()
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].lastUsed.Before(candidates[j].lastUsed) })
	for _, candidate := range candidates {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		data, err := candidate.rt.client.CallData(ctx, "get_state", nil)
		cancel()
		if err == nil {
			var state struct {
				IsStreaming bool `json:"isStreaming"`
			}
			if json.Unmarshal(data, &state) == nil && state.IsStreaming {
				m.mu.Lock()
				if current, ok := m.running[candidate.id]; ok && current == candidate.rt {
					current.lastUsed = time.Now()
				}
				m.mu.Unlock()
				continue
			}
		}
		m.mu.Lock()
		current, ok := m.running[candidate.id]
		removed := ok && current == candidate.rt && current.refs == 0
		if removed {
			delete(m.running, candidate.id)
		}
		m.mu.Unlock()
		if removed {
			candidate.rt.client.Stop()
			return nil
		}
	}
	return errors.New("too many active sessions; try again later")
}

// refreshMeta queries get_state and persists sessionFile/name changes.
func (m *Manager) refreshMeta(ctx context.Context, id string, client *pirpc.Client) error {
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	data, err := client.CallData(cctx, "get_state", nil)
	if err != nil {
		return fmt.Errorf("read pi state: %w", err)
	}
	var st struct {
		SessionFile string `json:"sessionFile"`
		SessionName string `json:"sessionName"`
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return fmt.Errorf("parse pi state: %w", err)
	}
	if st.SessionFile == "" {
		return errors.New("pi state did not include a session file")
	}
	if err := m.store.Update(id, func(meta *Meta) {
		if st.SessionFile != "" {
			meta.PiSessionFile = st.SessionFile
		}
		if st.SessionName != "" {
			meta.Name = st.SessionName
		}
		meta.InitialModelProvider = ""
		meta.InitialModelID = ""
		meta.LastActiveAt = time.Now()
	}); err != nil {
		return fmt.Errorf("persist pi state: %w", err)
	}
	return nil
}

// RefreshMeta re-reads pi state for a running session.
func (m *Manager) RefreshMeta(ctx context.Context, id string) error {
	client, release, ok := m.Borrow(id)
	if !ok {
		return nil
	}
	defer release()
	return m.refreshMeta(ctx, id, client)
}

// Touch refreshes the idle timer and persisted activity timestamp.
func (m *Manager) Touch(id string) error {
	m.mu.Lock()
	if rt, ok := m.running[id]; ok {
		rt.lastUsed = time.Now()
	}
	m.mu.Unlock()
	return m.store.Update(id, func(meta *Meta) { meta.LastActiveAt = time.Now() })
}

// IsRunning reports whether the session has a live pi process.
func (m *Manager) IsRunning(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	rt, ok := m.running[id]
	return ok && rt.client.Alive()
}

// StartEphemeral starts a capacity-limited sessionless process. The caller
// must invoke release, which removes and stops it.
func (m *Manager) StartEphemeral() (*pirpc.Client, func(), error) {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	m.mu.Lock()
	closing := m.closing
	m.mu.Unlock()
	if closing {
		return nil, nil, errors.New("server is shutting down")
	}
	if err := m.reserveProcessSlotLocked(); err != nil {
		return nil, nil, err
	}
	client, err := pirpc.Start(pirpc.Options{
		PiBinary:  m.cfg.PiBinary,
		Cwd:       m.cfg.WorkspacesRoot,
		ExtraArgs: []string{"--no-session"},
		ExtraEnv:  m.keys.Env(),
	})
	if err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	m.eph[client] = struct{}{}
	m.mu.Unlock()
	go func() {
		<-client.Done()
		m.mu.Lock()
		delete(m.eph, client)
		m.mu.Unlock()
	}()
	var once sync.Once
	release := func() {
		once.Do(func() {
			m.startMu.Lock()
			m.mu.Lock()
			delete(m.eph, client)
			m.mu.Unlock()
			client.Stop()
			m.startMu.Unlock()
		})
	}
	return client, release, nil
}

// Stop terminates the pi process for a session (metadata stays on disk).
func (m *Manager) Stop(id string) {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	m.stopLocked(id)
}

func (m *Manager) stopLocked(id string) {
	m.mu.Lock()
	rt, ok := m.running[id]
	if ok {
		delete(m.running, id)
	}
	m.mu.Unlock()
	if ok {
		rt.client.Stop()
	}
}

// Delete stops the session and, when requested, removes its persisted data.
func (m *Manager) Delete(id string, purge bool) error {
	m.startMu.Lock()
	defer m.startMu.Unlock()
	meta, ok := m.store.Get(id)
	if !ok {
		return errors.New("session not found")
	}
	m.stopLocked(id)
	if purge {
		if meta.PiSessionFile != "" {
			if err := os.Remove(meta.PiSessionFile); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove pi session file: %w", err)
			}
		}
		if meta.IsWorkspace {
			if !isSubPath(m.cfg.WorkspacesRoot, meta.Cwd) {
				return errors.New("refusing to purge workspace outside workspaces root")
			}
			if err := os.RemoveAll(meta.Cwd); err != nil {
				return fmt.Errorf("remove workspace: %w", err)
			}
		}
	}
	return m.store.Delete(id)
}

func isSubPath(root, p string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	if rootReal, realErr := filepath.EvalSymlinks(rootAbs); realErr == nil {
		rootAbs = rootReal
	}
	pAbs, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	if pReal, realErr := filepath.EvalSymlinks(pAbs); realErr == nil {
		pAbs = pReal
	} else if !errors.Is(realErr, os.ErrNotExist) {
		return false
	}
	rel, err := filepath.Rel(rootAbs, pAbs)
	if err != nil || rel == "." || rel == ".." {
		return false
	}
	return !filepath.IsAbs(rel) && !startsWithParent(rel)
}

func startsWithParent(rel string) bool {
	return len(rel) > 3 && rel[:3] == ".."+string(filepath.Separator)
}

// reapLoop periodically stops processes idle beyond the configured timeout.
func (m *Manager) reapLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopReaper:
			return
		case <-ticker.C:
		}
		cutoff := time.Now().Add(-time.Duration(m.cfg.IdleTimeoutMinutes) * time.Minute)
		m.mu.Lock()
		candidates := map[string]*runtime{}
		for id, rt := range m.running {
			if rt.refs == 0 && rt.lastUsed.Before(cutoff) {
				candidates[id] = rt
			}
		}
		m.mu.Unlock()

		for id, rt := range candidates {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			data, err := rt.client.CallData(ctx, "get_state", nil)
			cancel()
			if err == nil {
				var st struct {
					IsStreaming bool `json:"isStreaming"`
				}
				if json.Unmarshal(data, &st) == nil && st.IsStreaming {
					_ = m.Touch(id)
					continue
				}
			}
			m.startMu.Lock()
			m.mu.Lock()
			cur, ok := m.running[id]
			stillIdle := ok && cur == rt && cur.refs == 0 && cur.lastUsed.Before(cutoff)
			if stillIdle {
				delete(m.running, id)
			}
			m.mu.Unlock()
			if stillIdle {
				rt.client.Stop()
			}
			m.startMu.Unlock()
		}
	}
}

// Shutdown stops the reaper and all subprocesses. It is idempotent.
func (m *Manager) Shutdown() {
	m.shutdownOnce.Do(func() {
		close(m.stopReaper)
		m.startMu.Lock()
		m.mu.Lock()
		m.closing = true
		clients := make([]*pirpc.Client, 0, len(m.running)+len(m.eph))
		for _, rt := range m.running {
			clients = append(clients, rt.client)
		}
		for client := range m.eph {
			clients = append(clients, client)
		}
		m.running = map[string]*runtime{}
		m.eph = map[*pirpc.Client]struct{}{}
		m.mu.Unlock()

		var wg sync.WaitGroup
		for _, client := range clients {
			wg.Add(1)
			go func() {
				defer wg.Done()
				client.Stop()
			}()
		}
		wg.Wait()
		m.startMu.Unlock()
	})
}
