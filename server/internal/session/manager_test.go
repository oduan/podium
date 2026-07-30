package session

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sync"
	"testing"
	"time"

	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/pirpc"
)

func TestPendingSessionIsPreparedWithDefaultWorkspace(t *testing.T) {
	dataDir := t.TempDir()
	workspacesRoot := t.TempDir()
	cfg := &config.Config{
		PiBinary: "unused", WorkspacesRoot: workspacesRoot, MaxProcesses: 1, IdleTimeoutMinutes: 1,
	}
	store, err := NewStore(filepath.Join(dataDir, "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	keyStore, err := keys.NewStore(filepath.Join(dataDir, "keys.json"))
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(cfg, store, keyStore)
	defer manager.Shutdown()

	pending, err := manager.Create(context.Background(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !pending.Pending || pending.Cwd != "" || manager.IsRunning(pending.ID) {
		t.Fatalf("unexpected pending session: %+v", pending)
	}

	prepared, err := manager.Prepare(pending.ID, "", "example-provider", "example-model")
	if err != nil {
		t.Fatal(err)
	}
	wantCwd := filepath.Join(workspacesRoot, pending.ID)
	if prepared.Pending || !prepared.IsWorkspace || prepared.Cwd != wantCwd {
		t.Fatalf("unexpected prepared session: %+v, want cwd %q", prepared, wantCwd)
	}
	if prepared.InitialModelProvider != "example-provider" || prepared.InitialModelID != "example-model" {
		t.Fatalf("initial model was not persisted: %+v", prepared)
	}
	if info, err := os.Stat(prepared.Cwd); err != nil || !info.IsDir() {
		t.Fatalf("default workspace was not created: info=%v err=%v", info, err)
	}
	if _, err := manager.Prepare(pending.ID, "", "", ""); !errors.Is(err, ErrSessionAlreadyPrepared) {
		t.Fatalf("second Prepare error = %v, want ErrSessionAlreadyPrepared", err)
	}
}

func TestConcurrentAcquireStartsOneProcessAndPinsCapacity(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required for the pi RPC stub")
	}
	stubName := "stub-pi.sh"
	if goruntime.GOOS == "windows" {
		stubName = "stub-pi.cmd"
	}
	stub, err := filepath.Abs(filepath.Join("..", "..", "testdata", stubName))
	if err != nil {
		t.Fatal(err)
	}
	if goruntime.GOOS != "windows" {
		if err := os.Chmod(stub, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	dataDir := t.TempDir()
	workspace := t.TempDir()
	cfg := &config.Config{
		PiBinary: stub, WorkspacesRoot: workspace, MaxProcesses: 1, IdleTimeoutMinutes: 1,
	}
	store, err := NewStore(filepath.Join(dataDir, "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	keyStore, err := keys.NewStore(filepath.Join(dataDir, "keys.json"))
	if err != nil {
		t.Fatal(err)
	}
	meta := Meta{
		ID: "shared", Cwd: workspace, CreatedAt: time.Now(), LastActiveAt: time.Now(),
	}
	if err := store.Put(meta); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(cfg, store, keyStore)
	defer manager.Shutdown()

	type acquired struct {
		client  *pirpc.Client
		release func()
		err     error
	}
	const callers = 8
	results := make(chan acquired, callers)
	start := make(chan struct{})
	hold := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			client, release, err := manager.Acquire(ctx, "shared")
			cancel()
			results <- acquired{client: client, release: release, err: err}
			if err == nil {
				<-hold
				release()
			}
		}()
	}
	close(start)
	var first *pirpc.Client
	for i := 0; i < callers; i++ {
		result := <-results
		if result.err != nil {
			t.Fatalf("Acquire failed: %v", result.err)
		}
		if first == nil {
			first = result.client
		} else if result.client != first {
			t.Fatal("concurrent Acquire returned clients from multiple pi processes")
		}
	}
	if client, release, err := manager.StartEphemeral(); err == nil {
		release()
		client.Stop()
		t.Fatal("ephemeral process bypassed the pinned process cap")
	}
	close(hold)
	wg.Wait()
}
