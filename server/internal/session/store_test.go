package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStorePersistsRepeatedUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	meta := Meta{ID: "one", Name: "before", Cwd: t.TempDir(), CreatedAt: time.Now(), LastActiveAt: time.Now()}
	if err := store.Put(meta); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(meta.ID, func(item *Meta) { item.Name = "after" }); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reloaded.Get(meta.ID)
	if !ok || got.Name != "after" {
		t.Fatalf("reloaded metadata = %+v, found=%v", got, ok)
	}
}

func TestStoreRollsBackMemoryWhenSaveFails(t *testing.T) {
	parent := t.TempDir()
	blocker := filepath.Join(parent, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	meta := &Meta{ID: "one", Name: "before"}
	store := &Store{
		path:     filepath.Join(blocker, "sessions.json"),
		sessions: map[string]*Meta{"one": meta},
	}
	if err := store.Update("one", func(item *Meta) { item.Name = "after" }); err == nil {
		t.Fatal("Update succeeded despite an invalid store path")
	}
	if got, _ := store.Get("one"); got.Name != "before" {
		t.Fatalf("failed Update leaked into memory: %+v", got)
	}
	if err := store.Delete("one"); err == nil {
		t.Fatal("Delete succeeded despite an invalid store path")
	}
	if _, ok := store.Get("one"); !ok {
		t.Fatal("failed Delete removed the in-memory record")
	}
	if err := store.Put(Meta{ID: "two"}); err == nil {
		t.Fatal("Put succeeded despite an invalid store path")
	}
	if _, ok := store.Get("two"); ok {
		t.Fatal("failed Put leaked into memory")
	}
}

func TestNewStoreRejectsNullRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, []byte("[null]"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path); err == nil {
		t.Fatal("NewStore accepted a null session record")
	}
}
