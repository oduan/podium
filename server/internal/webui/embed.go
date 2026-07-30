// Package webui exposes the production frontend bundled into the Go binary.
package webui

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed dist
var embedded embed.FS

// Assets returns the root of the embedded Vite build.
func Assets() fs.FS {
	assets, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(fmt.Sprintf("open embedded web assets: %v", err))
	}
	return assets
}
