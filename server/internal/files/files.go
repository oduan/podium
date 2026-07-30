// Package files provides directory listing and file reading confined to a
// root directory, with protection against path traversal.
package files

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// MaxFileSize is the largest file content served to the UI.
const MaxFileSize = 2 * 1024 * 1024

// MaxDirectoryEntries bounds one directory-list response.
const MaxDirectoryEntries = 10_000

var (
	ErrOutsideRoot       = errors.New("path is outside the allowed root")
	ErrDirectoryTooLarge = errors.New("directory contains too many entries")
)

// Entry describes one directory entry.
type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"` // path relative to the root, using forward slashes
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// FileContent is the result of reading a file.
type FileContent struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Binary    bool   `json:"binary"`
	Truncated bool   `json:"truncated"`
	Content   string `json:"content"` // empty when Binary
}

// Resolve joins rel to root and verifies the result stays inside root.
// rel uses forward or backward slashes; "" or "." means the root itself.
func Resolve(root, rel string) (string, error) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", err
	}
	cleaned, err := normalizeRel(rel)
	if err != nil {
		return "", err
	}
	if cleaned == "." {
		return rootReal, nil
	}
	fullReal, err := filepath.EvalSymlinks(filepath.Join(rootReal, cleaned))
	if err != nil {
		return "", err
	}
	within, err := filepath.Rel(rootReal, fullReal)
	if err != nil {
		return "", err
	}
	if within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) || filepath.IsAbs(within) {
		return "", ErrOutsideRoot
	}
	return fullReal, nil
}

func normalizeRel(rel string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(rel))
	if cleaned == "." || cleaned == string(filepath.Separator) {
		return ".", nil
	}
	if filepath.IsAbs(cleaned) || filepath.VolumeName(cleaned) != "" || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", ErrOutsideRoot
	}
	return cleaned, nil
}

// List returns the entries of the directory at rel under root,
// directories first, then files, both alphabetically.
func List(root, rel string) ([]Entry, error) {
	rootReal, err := Resolve(root, "")
	if err != nil {
		return nil, err
	}
	cleaned, err := normalizeRel(rel)
	if err != nil {
		return nil, err
	}
	if _, err := Resolve(rootReal, cleaned); err != nil {
		return nil, err
	}
	rootHandle, err := os.OpenRoot(rootReal)
	if err != nil {
		return nil, err
	}
	defer rootHandle.Close()
	dir, err := rootHandle.Open(cleaned)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	dirents, err := dir.ReadDir(MaxDirectoryEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if len(dirents) > MaxDirectoryEntries {
		return nil, ErrDirectoryTooLarge
	}
	entries := make([]Entry, 0, len(dirents))
	base := strings.Trim(filepath.ToSlash(cleaned), "/")
	if base == "." {
		base = ""
	}
	for _, de := range dirents {
		relPath := de.Name()
		if base != "" {
			relPath = base + "/" + de.Name()
		}
		isDir := de.IsDir()
		var size int64
		entryRel := filepath.Join(cleaned, de.Name())
		if info, err := rootHandle.Stat(entryRel); err == nil {
			isDir = info.IsDir()
			if !isDir {
				size = info.Size()
			}
		}
		entries = append(entries, Entry{
			Name:  de.Name(),
			Path:  relPath,
			IsDir: isDir,
			Size:  size,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// Read returns the content of the file at rel under root. Files larger than
// MaxFileSize are truncated; binary files are flagged and content omitted.
func Read(root, rel string) (*FileContent, error) {
	rootReal, err := Resolve(root, "")
	if err != nil {
		return nil, err
	}
	cleaned, err := normalizeRel(rel)
	if err != nil {
		return nil, err
	}
	if _, err := Resolve(rootReal, cleaned); err != nil {
		return nil, err
	}
	rootHandle, err := os.OpenRoot(rootReal)
	if err != nil {
		return nil, err
	}
	defer rootHandle.Close()
	f, err := rootHandle.Open(cleaned)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("path is a directory")
	}
	buf, err := io.ReadAll(io.LimitReader(f, MaxFileSize+1))
	if err != nil {
		return nil, err
	}
	truncated := len(buf) > MaxFileSize
	if truncated {
		buf = buf[:MaxFileSize]
	}

	fc := &FileContent{
		Path:      filepath.ToSlash(cleaned),
		Size:      info.Size(),
		Truncated: truncated,
	}
	if isBinary(buf) {
		fc.Binary = true
		return fc, nil
	}
	fc.Content = string(buf)
	return fc, nil
}

// isBinary uses a NUL-byte and UTF-8 validity heuristic on the first chunk.
func isBinary(data []byte) bool {
	probe := data
	if len(probe) > 8000 {
		probe = probe[:8000]
	}
	if bytes.IndexByte(probe, 0) >= 0 {
		return true
	}
	if utf8.Valid(probe) {
		return false
	}
	// The 8 KiB probe can end in the middle of one valid UTF-8 rune.
	start := len(probe) - 1
	for start >= 0 && len(probe)-start <= utf8.UTFMax {
		if utf8.RuneStart(probe[start]) {
			if !utf8.FullRune(probe[start:]) && utf8.Valid(probe[:start]) {
				return false
			}
			return true
		}
		start--
	}
	return true
}
