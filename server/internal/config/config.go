// Package config loads Podium server configuration from defaults,
// ~/.podium/config.json, environment variables (PODIUM_*), and flags.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds all server settings.
type Config struct {
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Token              string `json:"token"`
	DataDir            string `json:"data_dir"`
	WorkspacesRoot     string `json:"workspaces_root"`
	PiBinary           string `json:"pi_binary"`
	AllowedBrowseRoot  string `json:"allowed_browse_root"`
	IdleTimeoutMinutes int    `json:"idle_timeout_minutes"`
	MaxProcesses       int    `json:"max_processes"`
	StaticDir          string `json:"static_dir"`
}

func defaults() Config {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, ".podium")
	return Config{
		Host:               "0.0.0.0",
		Port:               38273,
		DataDir:            dataDir,
		WorkspacesRoot:     filepath.Join(dataDir, "workspaces"),
		PiBinary:           "pi",
		AllowedBrowseRoot:  home,
		IdleTimeoutMinutes: 15,
		MaxProcesses:       5,
	}
}

// Load resolves configuration with precedence: flags > env > config file > defaults.
// --data-dir and PODIUM_DATA_DIR also select the default config-file location;
// PODIUM_CONFIG always wins when set.
func Load(args []string) (*Config, error) {
	cfg := defaults()
	configDataDir := cfg.DataDir
	if v := os.Getenv("PODIUM_DATA_DIR"); v != "" {
		configDataDir = v
	}
	if v, ok := dataDirFlag(args); ok {
		configDataDir = v
	}
	cfgPath := os.Getenv("PODIUM_CONFIG")
	if cfgPath == "" {
		cfgPath = filepath.Join(configDataDir, "config.json")
	}

	workspaceExplicit := false
	if data, err := os.ReadFile(cfgPath); err == nil {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return nil, fmt.Errorf("parse %s: %w", cfgPath, err)
		}
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parse %s: %w", cfgPath, err)
		}
		_, workspaceExplicit = fields["workspaces_root"]
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read %s: %w", cfgPath, err)
	}

	envWorkspace, err := applyEnv(&cfg)
	if err != nil {
		return nil, err
	}
	workspaceExplicit = workspaceExplicit || envWorkspace

	fs := flag.NewFlagSet("podium", flag.ContinueOnError)
	fs.StringVar(&cfg.Host, "host", cfg.Host, "listen host")
	fs.IntVar(&cfg.Port, "port", cfg.Port, "listen port")
	fs.StringVar(&cfg.Token, "token", cfg.Token, "auth token (generated if empty)")
	fs.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "podium data directory")
	fs.StringVar(&cfg.WorkspacesRoot, "workspaces-root", cfg.WorkspacesRoot, "root for default session workspaces")
	fs.StringVar(&cfg.PiBinary, "pi-binary", cfg.PiBinary, "path to the pi executable")
	fs.StringVar(&cfg.AllowedBrowseRoot, "browse-root", cfg.AllowedBrowseRoot, "root directory exposed to the folder picker")
	fs.IntVar(&cfg.IdleTimeoutMinutes, "idle-timeout", cfg.IdleTimeoutMinutes, "minutes before idle pi processes are stopped")
	fs.IntVar(&cfg.MaxProcesses, "max-processes", cfg.MaxProcesses, "max concurrent pi processes")
	fs.StringVar(&cfg.StaticDir, "static-dir", cfg.StaticDir, "directory of web assets overriding the embedded UI")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if fs.NArg() != 0 {
		return nil, fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
	}
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "workspaces-root" {
			workspaceExplicit = true
		}
	})
	if !workspaceExplicit {
		cfg.WorkspacesRoot = filepath.Join(cfg.DataDir, "workspaces")
	}

	if cfg.Port < 1 || cfg.Port > 65535 {
		return nil, fmt.Errorf("port must be between 1 and 65535")
	}
	if cfg.IdleTimeoutMinutes < 1 {
		return nil, errors.New("idle timeout must be at least 1 minute")
	}
	if cfg.MaxProcesses < 1 {
		return nil, errors.New("max processes must be at least 1")
	}
	if strings.TrimSpace(cfg.PiBinary) == "" {
		return nil, errors.New("pi binary must not be empty")
	}
	if strings.TrimSpace(cfg.AllowedBrowseRoot) == "" {
		return nil, errors.New("browse root must not be empty")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(cfg.WorkspacesRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create workspaces root: %w", err)
	}
	if cfg.DataDir, err = canonicalDirectory(cfg.DataDir); err != nil {
		return nil, fmt.Errorf("resolve data dir: %w", err)
	}
	if cfg.WorkspacesRoot, err = canonicalDirectory(cfg.WorkspacesRoot); err != nil {
		return nil, fmt.Errorf("resolve workspaces root: %w", err)
	}
	if cfg.AllowedBrowseRoot, err = canonicalDirectory(cfg.AllowedBrowseRoot); err != nil {
		return nil, fmt.Errorf("resolve browse root: %w", err)
	}
	if cfg.StaticDir != "" {
		if cfg.StaticDir, err = canonicalDirectory(cfg.StaticDir); err != nil {
			return nil, fmt.Errorf("resolve static directory: %w", err)
		}
	}

	if cfg.Token == "" {
		tok, err := generateToken()
		if err != nil {
			return nil, err
		}
		cfg.Token = tok
		if err := persistToken(cfgPath, cfg.Token); err != nil {
			return nil, fmt.Errorf("persist generated token: %w", err)
		}
		fmt.Fprintf(os.Stderr, "podium: generated auth token: %s (saved to %s)\n", tok, cfgPath)
	}
	return &cfg, nil
}

func canonicalDirectory(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("path is not a directory")
	}
	return real, nil
}

func dataDirFlag(args []string) (string, bool) {
	for i, arg := range args {
		if arg == "--data-dir" || arg == "-data-dir" {
			if i+1 < len(args) {
				return args[i+1], true
			}
			return "", false
		}
		if strings.HasPrefix(arg, "--data-dir=") || strings.HasPrefix(arg, "-data-dir=") {
			return strings.SplitN(arg, "=", 2)[1], true
		}
	}
	return "", false
}

func applyEnv(cfg *Config) (bool, error) {
	if v := os.Getenv("PODIUM_HOST"); v != "" {
		cfg.Host = v
	}
	if v := os.Getenv("PODIUM_PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return false, fmt.Errorf("invalid PODIUM_PORT: %w", err)
		}
		cfg.Port = p
	}
	if v := os.Getenv("PODIUM_TOKEN"); v != "" {
		cfg.Token = v
	}
	if v := os.Getenv("PODIUM_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	workspaceExplicit := false
	if v := os.Getenv("PODIUM_WORKSPACES_ROOT"); v != "" {
		cfg.WorkspacesRoot = v
		workspaceExplicit = true
	}
	if v := os.Getenv("PODIUM_PI_BINARY"); v != "" {
		cfg.PiBinary = v
	}
	if v := os.Getenv("PODIUM_BROWSE_ROOT"); v != "" {
		cfg.AllowedBrowseRoot = v
	}
	if v := os.Getenv("PODIUM_IDLE_TIMEOUT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return false, fmt.Errorf("invalid PODIUM_IDLE_TIMEOUT: %w", err)
		}
		cfg.IdleTimeoutMinutes = n
	}
	if v := os.Getenv("PODIUM_MAX_PROCESSES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return false, fmt.Errorf("invalid PODIUM_MAX_PROCESSES: %w", err)
		}
		cfg.MaxProcesses = n
	}
	if v := os.Getenv("PODIUM_STATIC_DIR"); v != "" {
		cfg.StaticDir = v
	}
	return workspaceExplicit, nil
}

func generateToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// persistToken merges the token into the config file using an atomic replace.
func persistToken(path, token string) error {
	m := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &m); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	m["token"] = token
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
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
	return os.Rename(tmpName, path)
}
