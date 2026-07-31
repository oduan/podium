package main

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestUpdateCommandWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-specific command")
	}
	cmd := updateCommand()
	if !strings.Contains(cmd, "install.ps1 | iex") {
		t.Fatalf("windows update command missing installer: %s", cmd)
	}
	if !strings.HasPrefix(cmd, "powershell -NoProfile -ExecutionPolicy Bypass -Command") {
		t.Fatalf("windows update command missing powershell wrapper: %s", cmd)
	}
}

func TestUpdateCommandUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix-specific command")
	}
	cmd := updateCommand()
	if !strings.Contains(cmd, "curl -fsSL") || !strings.Contains(cmd, "install.sh | sh") {
		t.Fatalf("unix update command missing installer: %s", cmd)
	}
}

func TestUpdateCommandPinsNonDefaultInstallDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix branch")
	}
	dir, err := filepath.Abs(filepath.Join(t.TempDir(), "bin"))
	if err != nil {
		t.Fatal(err)
	}
	cmd := updateCommandForDir(dir)
	if !strings.Contains(cmd, "PODIUM_INSTALL_DIR=") {
		t.Fatalf("non-default install dir was not pinned: %s", cmd)
	}
	if !strings.Contains(cmd, dir) {
		t.Fatalf("install dir %q missing from command: %s", dir, cmd)
	}
}
