package webui

import (
	"io/fs"
	"strings"
	"testing"
)

func TestEmbeddedBuildContainsApplication(t *testing.T) {
	index, err := fs.ReadFile(Assets(), "index.html")
	if err != nil {
		t.Fatalf("read embedded index: %v", err)
	}
	if !strings.Contains(string(index), `<div id="root"></div>`) {
		t.Fatal("embedded index does not contain the React root")
	}

	entries, err := fs.Glob(Assets(), "assets/*")
	if err != nil {
		t.Fatalf("list embedded assets: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("embedded frontend contains no compiled assets")
	}
}
