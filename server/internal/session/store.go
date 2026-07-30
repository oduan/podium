// Package session manages Podium session metadata and the lifecycle of the
// pi RPC subprocesses backing them.
package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Meta is the persisted record of one Podium session.
type Meta struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Cwd                  string    `json:"cwd"`
	PiSessionFile        string    `json:"piSessionFile,omitempty"`
	IsWorkspace          bool      `json:"isWorkspace"` // cwd was auto-created under workspaces root
	Pending              bool      `json:"pending,omitempty"`
	InitialModelProvider string    `json:"initialModelProvider,omitempty"`
	InitialModelID       string    `json:"initialModelId,omitempty"`
	CreatedAt            time.Time `json:"createdAt"`
	LastActiveAt         time.Time `json:"lastActiveAt"`
}

// Store persists session metadata to a JSON file with atomic writes.
type Store struct {
	path string

	mu       sync.Mutex
	sessions map[string]*Meta
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, sessions: map[string]*Meta{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, err
	}
	var list []*Meta
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	if list == nil {
		return nil, errors.New("session store must contain a JSON array")
	}
	for _, m := range list {
		if m == nil || m.ID == "" {
			return nil, errors.New("session store contains an invalid record")
		}
		if _, exists := s.sessions[m.ID]; exists {
			return nil, fmt.Errorf("session store contains duplicate id %q", m.ID)
		}
		s.sessions[m.ID] = m
	}
	return s, nil
}

// List returns all sessions, most recently active first.
func (s *Store) List() []Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Meta, 0, len(s.sessions))
	for _, m := range s.sessions {
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].LastActiveAt.After(out[j].LastActiveAt)
	})
	return out
}

// Get returns a copy of the session with the given id.
func (s *Store) Get(id string) (Meta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.sessions[id]
	if !ok {
		return Meta{}, false
	}
	return *m, true
}

// Put inserts or replaces a session record and persists.
func (s *Store) Put(m Meta) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old, existed := s.sessions[m.ID]
	cp := m
	s.sessions[m.ID] = &cp
	if err := s.saveLocked(); err != nil {
		if existed {
			s.sessions[m.ID] = old
		} else {
			delete(s.sessions, m.ID)
		}
		return err
	}
	return nil
}

// Update applies fn to the stored record (if present) and persists.
func (s *Store) Update(id string, fn func(*Meta)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.sessions[id]
	if !ok {
		return errors.New("session not found")
	}
	before := *m
	fn(m)
	if err := s.saveLocked(); err != nil {
		*m = before
		return err
	}
	return nil
}

// Delete removes a session record and persists.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old, existed := s.sessions[id]
	if !existed {
		return errors.New("session not found")
	}
	delete(s.sessions, id)
	if err := s.saveLocked(); err != nil {
		if existed {
			s.sessions[id] = old
		}
		return err
	}
	return nil
}

func (s *Store) saveLocked() error {
	list := make([]*Meta, 0, len(s.sessions))
	for _, m := range s.sessions {
		list = append(list, m)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.Before(list[j].CreatedAt) })
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(s.path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.path)
}

// NewID returns a 128-bit random session id.
func NewID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
