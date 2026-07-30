// Command podium runs the pi Agent web backend: an HTTP + WebSocket server
// that drives per-session `pi --mode rpc` subprocesses.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"podium/server/internal/api"
	"podium/server/internal/auth"
	"podium/server/internal/config"
	"podium/server/internal/keys"
	"podium/server/internal/session"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("podium: %v", err)
	}
}

func run() error {
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
		log.Printf("podium listening on http://%s (pi binary: %s)", addr, cfg.PiBinary)
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
