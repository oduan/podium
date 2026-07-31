// Command podium runs the pi Agent web backend: an HTTP + WebSocket server
// that drives per-session `pi --mode rpc` subprocesses.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"podium/server/internal/api"
	"podium/server/internal/auth"
	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/session"
)

// version is injected at build time via -X main.version=<tag>.
var version = "dev"

const (
	repoOwner   = "oduan"
	repoName    = "podium"
	repoRawBase = "https://raw.githubusercontent.com/oduan/podium/main/scripts"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("podium: %v", err)
	}
}

func run() error {
	if isUpdateCommand(os.Args[1:]) {
		return runUpdate()
	}

	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		return err
	}

	store, err := session.NewStore(filepath.Join(cfg.DataDir, "sessions.json"))
	if err != nil {
		return fmt.Errorf("load session store: %w", err)
	}
	keyStore, err := keys.NewStore(filepath.Join(cfg.DataDir, "keys.json"))
	if err != nil {
		return fmt.Errorf("load key store: %w", err)
	}

	manager := session.NewManager(cfg, store, keyStore)
	authn := auth.New(cfg.Token)
	srv := api.NewServer(cfg, authn, manager, keyStore)

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("podium listening on %s (pi binary: %s)", accessURLs(cfg), cfg.PiBinary)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("podium: shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	manager.Shutdown()
	return nil
}

// accessURLs returns the token-bearing URLs printed at startup.
// Loopback is always listed; LAN addresses are included when listening
// on all interfaces so the printed URLs are usable from other machines.
func accessURLs(cfg *config.Config) string {
	hosts := []string{"localhost"}
	if cfg.Host == "0.0.0.0" || cfg.Host == "::" || cfg.Host == "" {
		hosts = append(hosts, lanIPs()...)
	}
	urls := make([]string, 0, len(hosts))
	for _, h := range hosts {
		urls = append(urls, fmt.Sprintf("http://%s:%d/?token=%s", h, cfg.Port, cfg.Token))
	}
	return strings.Join(urls, "  ")
}

// lanIPs returns up to three non-loopback, non-link-local IPv4 addresses.
func lanIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, a := range addrs {
		if len(ips) >= 3 {
			break
		}
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() || ipnet.IP.IsLinkLocalUnicast() {
			continue
		}
		ip4 := ipnet.IP.To4()
		if ip4 == nil {
			continue
		}
		ips = append(ips, ip4.String())
	}
	return ips
}

// isUpdateCommand reports whether the arguments request the `update` subcommand.
func isUpdateCommand(args []string) bool {
	return len(args) > 0 && args[0] == "update"
}

// runUpdate prints the current and latest versions plus the exact command the
// user can run to update Podium. It never modifies the installation itself.
func runUpdate() error {
	fmt.Printf("Podium current version: %s\n", version)

	latest, err := latestRelease()
	if err != nil {
		fmt.Printf("Podium latest version:  unknown (could not query GitHub: %v)\n", err)
	} else {
		fmt.Printf("Podium latest version:  %s\n", latest)
		if version != "dev" && version == latest {
			fmt.Println("You are already running the latest release.")
		}
	}

	fmt.Println()
	fmt.Println("To update, stop any running Podium server and execute:")
	fmt.Println()
	fmt.Println(updateCommand())
	fmt.Println()
	return nil
}

// latestRelease queries the GitHub API for the newest release tag.
func latestRelease() (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", repoOwner, repoName)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "podium-update")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.Unmarshal(body, &release); err != nil {
		return "", err
	}
	if release.TagName == "" {
		return "", errors.New("GitHub response contained no tag")
	}
	return release.TagName, nil
}

// updateCommand returns the platform-appropriate reinstall command, pinning
// PODIUM_INSTALL_DIR to the directory of the currently running executable
// unless it matches the installer's default.
func updateCommand() string {
	exe, err := os.Executable()
	if err != nil {
		exe = "podium"
	}
	return updateCommandForDir(filepath.Dir(exe))
}

// updateCommandForDir builds the reinstall command for the given install dir.
func updateCommandForDir(installDir string) string {
	switch runtime.GOOS {
	case "windows":
		cmd := "irm " + repoRawBase + "/install.ps1 | iex"
		if !sameDir(installDir, filepath.Join(os.Getenv("LOCALAPPDATA"), "Podium", "bin")) {
			// single quotes: backslashes stay literal in PowerShell strings
			cmd = fmt.Sprintf("$env:PODIUM_INSTALL_DIR = '%s'; %s", installDir, cmd)
		}
		return "powershell -NoProfile -ExecutionPolicy Bypass -Command \"" + cmd + "\""
	default:
		cmd := "curl -fsSL " + repoRawBase + "/install.sh | sh"
		home, _ := os.UserHomeDir()
		if !sameDir(installDir, filepath.Join(home, ".local", "bin")) {
			cmd = fmt.Sprintf("PODIUM_INSTALL_DIR=%q %s", installDir, cmd)
		}
		return cmd
	}
}

// sameDir compares two paths canonically (case-insensitive on Windows).
func sameDir(a, b string) bool {
	aAbs, errA := filepath.Abs(a)
	bAbs, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(aAbs, bAbs)
	}
	return aAbs == bAbs
}
