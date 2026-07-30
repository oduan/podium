package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func clearPodiumEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"PODIUM_CONFIG", "PODIUM_HOST", "PODIUM_PORT", "PODIUM_TOKEN",
		"PODIUM_DATA_DIR", "PODIUM_WORKSPACES_ROOT", "PODIUM_PI_BINARY",
		"PODIUM_BROWSE_ROOT", "PODIUM_IDLE_TIMEOUT", "PODIUM_MAX_PROCESSES",
		"PODIUM_STATIC_DIR",
	} {
		t.Setenv(name, "")
	}
}

func TestDataDirFlagSelectsConfigAndDerivedWorkspace(t *testing.T) {
	clearPodiumEnv(t)
	dataDir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	configData, _ := json.Marshal(map[string]any{"token": "from-selected-config", "port": 8123})
	if err := os.WriteFile(filepath.Join(dataDir, "config.json"), configData, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load([]string{"--data-dir", dataDir})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Token != "from-selected-config" || cfg.Port != 8123 {
		t.Fatalf("selected config was not loaded: %+v", cfg)
	}
	if cfg.WorkspacesRoot != filepath.Join(dataDir, "workspaces") {
		t.Fatalf("workspace root = %q, want it under data dir", cfg.WorkspacesRoot)
	}
}

func TestExplicitWorkspaceIsNotRecomputed(t *testing.T) {
	clearPodiumEnv(t)
	dataDir := filepath.Join(t.TempDir(), "data")
	workspace := filepath.Join(t.TempDir(), "custom-workspace")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	configData, _ := json.Marshal(map[string]any{
		"token": "configured", "workspaces_root": workspace,
	})
	if err := os.WriteFile(filepath.Join(dataDir, "config.json"), configData, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load([]string{"--data-dir", dataDir})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkspacesRoot != workspace {
		t.Fatalf("explicit workspace root changed to %q", cfg.WorkspacesRoot)
	}
}

func TestInvalidNumericEnvironmentIsRejected(t *testing.T) {
	clearPodiumEnv(t)
	t.Setenv("PODIUM_DATA_DIR", filepath.Join(t.TempDir(), "data"))
	t.Setenv("PODIUM_PORT", "not-a-number")
	if _, err := Load(nil); err == nil {
		t.Fatal("invalid PODIUM_PORT was silently ignored")
	}
}
