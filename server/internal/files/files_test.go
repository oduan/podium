package files

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveRejectsTraversalButAllowsDotDotPrefix(t *testing.T) {
	root := t.TempDir()
	allowed := filepath.Join(root, "..config")
	if err := os.WriteFile(allowed, []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Resolve(root, "..config")
	if err != nil {
		t.Fatalf("legitimate prefix rejected: %v", err)
	}
	if got != allowed {
		t.Fatalf("Resolve() = %q, want %q", got, allowed)
	}
	if _, err := Resolve(root, "../outside"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("traversal error = %v, want ErrOutsideRoot", err)
	}
}

func TestResolveRejectsSymlinkEscape(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "root")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(parent, "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "escape.txt")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}
	if _, err := Resolve(root, "escape.txt"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("symlink escape error = %v, want ErrOutsideRoot", err)
	}
	if _, err := Read(root, "escape.txt"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("Read symlink escape error = %v, want ErrOutsideRoot", err)
	}
}

func TestReadLimitsAndClassifiesContent(t *testing.T) {
	root := t.TempDir()
	large := strings.Repeat("a", MaxFileSize+1)
	if err := os.WriteFile(filepath.Join(root, "large.txt"), []byte(large), 0o600); err != nil {
		t.Fatal(err)
	}
	content, err := Read(root, "large.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !content.Truncated || len(content.Content) != MaxFileSize || content.Binary {
		t.Fatalf("unexpected large-file result: %+v content length=%d", content, len(content.Content))
	}

	if err := os.WriteFile(filepath.Join(root, "binary.bin"), []byte{'a', 0, 'b'}, 0o600); err != nil {
		t.Fatal(err)
	}
	binary, err := Read(root, "binary.bin")
	if err != nil {
		t.Fatal(err)
	}
	if !binary.Binary || binary.Content != "" {
		t.Fatalf("binary file was exposed as text: %+v", binary)
	}
}

func TestBinaryUTF8BoundaryHeuristic(t *testing.T) {
	truncatedRune := append([]byte(strings.Repeat("a", 7999)), 0xe2)
	if isBinary(truncatedRune) {
		t.Fatal("valid UTF-8 prefix ending mid-rune was classified as binary")
	}
	if !isBinary([]byte{'a', 0xff, 'b'}) {
		t.Fatal("invalid UTF-8 in the middle was classified as text")
	}
}
