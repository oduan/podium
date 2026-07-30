package keys

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSetRollsBackWhenSaveFails(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := &Store{
		path: filepath.Join(blocker, "keys.json"),
		keys: map[string]string{"openai": "old"},
	}
	if err := store.Set("openai", "new"); err == nil {
		t.Fatal("Set succeeded despite an invalid store path")
	}
	if got := store.Env(); len(got) != 1 || got[0] != "OPENAI_API_KEY=old" {
		t.Fatalf("failed Set leaked into memory: %v", got)
	}
	if err := store.Set("anthropic", "new"); err == nil {
		t.Fatal("Set of a new provider unexpectedly succeeded")
	}
	if got := store.ListMasked(); len(got) != 1 || got[0].Provider != "openai" {
		t.Fatalf("failed Set added a provider: %+v", got)
	}
}

func TestStorePersistsRepeatedWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keys.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set("openai", "first-secret"); err != nil {
		t.Fatal(err)
	}
	if err := store.Set("openai", "second-secret"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.Env(); len(got) != 1 || got[0] != "OPENAI_API_KEY=second-secret" {
		t.Fatalf("reloaded keys = %v", got)
	}
}
