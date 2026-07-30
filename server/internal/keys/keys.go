// Package keys stores provider API keys server-side and exposes them as
// environment variables for spawned pi subprocesses.
package keys

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// envVarNames maps known provider ids to the env var pi expects.
var envVarNames = map[string]string{
	"anthropic":  "ANTHROPIC_API_KEY",
	"openai":     "OPENAI_API_KEY",
	"google":     "GEMINI_API_KEY",
	"groq":       "GROQ_API_KEY",
	"cerebras":   "CEREBRAS_API_KEY",
	"xai":        "XAI_API_KEY",
	"openrouter": "OPENROUTER_API_KEY",
	"mistral":    "MISTRAL_API_KEY",
	"zai":        "ZAI_API_KEY",
	"deepseek":   "DEEPSEEK_API_KEY",
}

// Store persists provider→key entries in a JSON file.
type Store struct {
	path string

	mu   sync.Mutex
	keys map[string]string // provider -> api key
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, keys: map[string]string{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, err
	}
	var stored map[string]string
	if err := json.Unmarshal(data, &stored); err != nil {
		return nil, err
	}
	if stored == nil {
		return nil, errors.New("key store must contain a JSON object")
	}
	envOwners := map[string]string{}
	for provider, key := range stored {
		normalized := strings.ToLower(strings.TrimSpace(provider))
		if normalized == "" || key == "" {
			return nil, errors.New("key store contains an invalid provider entry")
		}
		if _, exists := s.keys[normalized]; exists {
			return nil, errors.New("key store contains duplicate normalized providers")
		}
		envVar := EnvVarFor(normalized)
		if owner, exists := envOwners[envVar]; exists {
			return nil, errors.New("providers " + owner + " and " + normalized + " map to the same environment variable")
		}
		envOwners[envVar] = normalized
		s.keys[normalized] = key
	}
	return s, nil
}

// EnvVarFor returns the env var name used for a provider id.
func EnvVarFor(provider string) string {
	if v, ok := envVarNames[strings.ToLower(provider)]; ok {
		return v
	}
	sanitized := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		default:
			return '_'
		}
	}, strings.ToUpper(provider))
	return sanitized + "_API_KEY"
}

// Set stores (or with empty key removes) a provider key and persists.
func (s *Store) Set(provider, key string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	key = strings.TrimSpace(key)
	if provider == "" {
		return errors.New("provider is required")
	}
	if len(provider) > 128 {
		return errors.New("provider is too long")
	}
	if len(key) > 64*1024 {
		return errors.New("API key is too long")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if key != "" {
		envVar := EnvVarFor(provider)
		for existing := range s.keys {
			if existing != provider && EnvVarFor(existing) == envVar {
				return errors.New("provider maps to the same environment variable as " + existing)
			}
		}
	}
	old, existed := s.keys[provider]
	if key == "" {
		delete(s.keys, provider)
	} else {
		s.keys[provider] = key
	}
	if err := s.saveLocked(); err != nil {
		if existed {
			s.keys[provider] = old
		} else {
			delete(s.keys, provider)
		}
		return err
	}
	return nil
}

// MaskedEntry is a provider key entry safe to return to the UI.
type MaskedEntry struct {
	Provider string `json:"provider"`
	EnvVar   string `json:"envVar"`
	Masked   string `json:"masked"`
}

// ListMasked returns all configured providers with masked keys.
func (s *Store) ListMasked() []MaskedEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]MaskedEntry, 0, len(s.keys))
	for p, k := range s.keys {
		out = append(out, MaskedEntry{Provider: p, EnvVar: EnvVarFor(p), Masked: mask(k)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Provider < out[j].Provider })
	return out
}

// Env returns KEY=VALUE pairs for all stored keys.
func (s *Store) Env() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	env := make([]string, 0, len(s.keys))
	for p, k := range s.keys {
		env = append(env, EnvVarFor(p)+"="+k)
	}
	sort.Strings(env)
	return env
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.keys, "", "  ")
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

func mask(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "…" + key[len(key)-4:]
}
