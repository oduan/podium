// Package pirpc implements a client for pi's RPC mode: it manages a
// `pi --mode rpc` subprocess and speaks the JSONL protocol over its
// stdin/stdout (commands/responses on stdin/stdout, events on stdout).
package pirpc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxRPCLineSize      = 32 * 1024 * 1024
	maxSubscriberEvents = 1024
	maxSubscriberBytes  = 16 * 1024 * 1024
)

// Response is a parsed RPC response line.
type Response struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Command string          `json:"command"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// Options configures a Client.
type Options struct {
	PiBinary  string   // path or name of the pi executable
	Cwd       string   // working directory for the agent
	ExtraArgs []string // additional CLI args (e.g. --no-session)
	ExtraEnv  []string // additional environment entries KEY=VALUE
}

// Client wraps one pi RPC subprocess.
type Client struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	writeMu sync.Mutex // serializes stdin writes

	pendingMu sync.Mutex
	pending   map[string]chan Response

	nextID atomic.Int64

	subMu  sync.Mutex
	subs   map[int64]*subscriber
	subSeq int64

	done     chan struct{} // closed when the process has exited
	stderrMu sync.Mutex
	stderr   []byte // ring-ish tail of stderr for diagnostics
}

// subscriber is a bounded event queue drained into a channel. A client that
// cannot keep up is disconnected instead of growing server memory forever.
type subscriber struct {
	mu          sync.Mutex
	cond        *sync.Cond
	queue       [][]byte
	queuedBytes int
	closed      bool
	out         chan json.RawMessage
	discardOnce sync.Once
}

func newSubscriber() *subscriber {
	s := &subscriber{out: make(chan json.RawMessage, 16)}
	s.cond = sync.NewCond(&s.mu)
	go s.drain()
	return s
}

func (s *subscriber) push(line []byte) bool {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return false
	}
	if len(s.queue) >= maxSubscriberEvents || s.queuedBytes+len(line) > maxSubscriberBytes {
		s.closed = true
		s.queue = nil
		s.queuedBytes = 0
		s.cond.Broadcast()
		s.mu.Unlock()
		s.startDiscard()
		return false
	}
	s.queue = append(s.queue, line)
	s.queuedBytes += len(line)
	s.cond.Signal()
	s.mu.Unlock()
	return true
}

func (s *subscriber) drain() {
	for {
		s.mu.Lock()
		for len(s.queue) == 0 && !s.closed {
			s.cond.Wait()
		}
		if s.closed && len(s.queue) == 0 {
			s.mu.Unlock()
			close(s.out)
			return
		}
		line := s.queue[0]
		s.queue = s.queue[1:]
		s.queuedBytes -= len(line)
		s.mu.Unlock()
		s.out <- json.RawMessage(line)
	}
}

func (s *subscriber) close() {
	s.mu.Lock()
	s.closed = true
	s.queue = nil
	s.queuedBytes = 0
	s.cond.Broadcast()
	s.mu.Unlock()
	s.startDiscard()
}

func (s *subscriber) startDiscard() {
	// The drain goroutine may already be blocked sending one item. Consuming
	// here lets it observe closed and terminate after the caller leaves.
	s.discardOnce.Do(func() {
		go func() {
			for range s.out {
			}
		}()
	})
}

// Start spawns the pi subprocess and begins reading its stdout.
func Start(opts Options) (*Client, error) {
	bin, args, err := resolveCommand(opts.PiBinary, append([]string{"--mode", "rpc"}, opts.ExtraArgs...))
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = opts.Cwd
	cmd.Env = append(os.Environ(), opts.ExtraEnv...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi: %w", err)
	}

	c := &Client{
		cmd:     cmd,
		stdin:   stdin,
		pending: make(map[string]chan Response),
		subs:    make(map[int64]*subscriber),
		done:    make(chan struct{}),
	}
	go c.readStderr(stderr)
	go c.readLoop(stdout)
	return c, nil
}

// resolveCommand handles Windows .cmd/.bat shims (npm global installs).
func resolveCommand(bin string, args []string) (string, []string, error) {
	path, err := exec.LookPath(bin)
	if err != nil {
		return "", nil, fmt.Errorf("pi executable not found (%q): %w", bin, err)
	}
	if runtime.GOOS == "windows" {
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".cmd" || ext == ".bat" {
			return "cmd.exe", append([]string{"/c", path}, args...), nil
		}
	}
	return path, args, nil
}

// readLoop reads JSONL from stdout: strict LF framing, tolerate trailing CR.
func (c *Client) readLoop(stdout io.Reader) {
	reader := bufio.NewReaderSize(stdout, 64*1024)
	var readErr error
	for {
		line, err := readLine(reader)
		if len(line) > 0 {
			if dispatchErr := c.dispatch(line); dispatchErr != nil {
				readErr = dispatchErr
				break
			}
		}
		if err != nil {
			readErr = err
			break
		}
	}
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		_ = c.cmd.Process.Kill()
	}
	waitErr := c.cmd.Wait()
	exitErr := errors.New("pi process exited")
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		exitErr = fmt.Errorf("read pi RPC output: %w", readErr)
	} else if waitErr != nil {
		exitErr = fmt.Errorf("pi process exited: %w", waitErr)
	}
	close(c.done)
	c.failPending(exitErr)
	c.closeSubscribers()
}

// readLine reads one bounded JSONL record, stripping LF and an optional CR.
func readLine(r *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf)+len(chunk) > maxRPCLineSize {
			return nil, fmt.Errorf("RPC record exceeds %d bytes", maxRPCLineSize)
		}
		buf = append(buf, chunk...)
		if err == bufio.ErrBufferFull {
			continue
		}
		buf = bytes.TrimSuffix(buf, []byte("\n"))
		buf = bytes.TrimSuffix(buf, []byte("\r"))
		return buf, err
	}
}

func (c *Client) dispatch(line []byte) error {
	var probe struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &probe); err != nil {
		return fmt.Errorf("invalid JSON record: %w", err)
	}
	if probe.Type == "" {
		return errors.New("RPC record is missing its type")
	}
	if probe.Type == "response" && probe.ID != "" {
		c.pendingMu.Lock()
		ch, ok := c.pending[probe.ID]
		if ok {
			delete(c.pending, probe.ID)
		}
		c.pendingMu.Unlock()
		if ok {
			var resp Response
			if err := json.Unmarshal(line, &resp); err != nil {
				return fmt.Errorf("invalid RPC response: %w", err)
			}
			ch <- resp
			return nil
		}
		if strings.HasPrefix(probe.ID, "srv-") {
			return nil // late response to a timed-out internal call
		}
		// Response for an unknown id: fall through and broadcast, a
		// passthrough client may be interested.
	}
	c.broadcast(line)
	return nil
}

func (c *Client) broadcast(line []byte) {
	// Copy: line buffer may be reused by the reader.
	cp := make([]byte, len(line))
	copy(cp, line)
	c.subMu.Lock()
	dropped := make([]*subscriber, 0)
	for id, s := range c.subs {
		if !s.push(cp) {
			delete(c.subs, id)
			dropped = append(dropped, s)
		}
	}
	c.subMu.Unlock()
	for _, s := range dropped {
		s.close()
	}
}

func (c *Client) readStderr(stderr io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := stderr.Read(buf)
		if n > 0 {
			c.stderrMu.Lock()
			c.stderr = append(c.stderr, buf[:n]...)
			if len(c.stderr) > 16*1024 {
				c.stderr = c.stderr[len(c.stderr)-16*1024:]
			}
			c.stderrMu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// StderrTail returns the last captured stderr output (for diagnostics).
func (c *Client) StderrTail() string {
	c.stderrMu.Lock()
	defer c.stderrMu.Unlock()
	return string(c.stderr)
}

func (c *Client) failPending(err error) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	for id, ch := range c.pending {
		ch <- Response{Type: "response", Success: false, Error: err.Error(), ID: id}
		delete(c.pending, id)
	}
}

func (c *Client) closeSubscribers() {
	c.subMu.Lock()
	subs := make([]*subscriber, 0, len(c.subs))
	for _, s := range c.subs {
		subs = append(subs, s)
	}
	c.subs = map[int64]*subscriber{}
	c.subMu.Unlock()
	for _, s := range subs {
		s.close()
	}
}

// Subscribe registers an event listener. The returned channel yields raw
// event lines (JSON). Call cancel to unsubscribe; the channel is closed when
// unsubscribed or when the process exits.
func (c *Client) Subscribe() (<-chan json.RawMessage, func()) {
	s := newSubscriber()
	c.subMu.Lock()
	c.subSeq++
	id := c.subSeq
	c.subs[id] = s
	c.subMu.Unlock()

	select {
	case <-c.done:
		// Process already exited; close immediately.
		c.subMu.Lock()
		delete(c.subs, id)
		c.subMu.Unlock()
		s.close()
	default:
	}

	cancel := func() {
		c.subMu.Lock()
		if cur, ok := c.subs[id]; ok && cur == s {
			delete(c.subs, id)
		}
		c.subMu.Unlock()
		s.close()
	}
	return s.out, cancel
}

// Done is closed when the subprocess exits.
func (c *Client) Done() <-chan struct{} { return c.done }

// Alive reports whether the subprocess is still running.
func (c *Client) Alive() bool {
	select {
	case <-c.done:
		return false
	default:
		return true
	}
}

// SendRaw writes an arbitrary JSON value as one JSONL record (no response
// expected), e.g. extension_ui_response messages.
func (c *Client) SendRaw(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.writeLine(data)
}

func (c *Client) writeLine(data []byte) error {
	if !c.Alive() {
		return errors.New("pi process exited")
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := c.stdin.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write to pi: %w", err)
	}
	return nil
}

// Call sends a command of the given type with extra fields and waits for the
// matching response. fields must be JSON-marshalable (may be nil).
func (c *Client) Call(ctx context.Context, cmdType string, fields map[string]any) (Response, error) {
	id := "srv-" + strconv.FormatInt(c.nextID.Add(1), 10)
	msg := map[string]any{"id": id, "type": cmdType}
	for k, v := range fields {
		if k == "id" || k == "type" {
			continue
		}
		msg[k] = v
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return Response{}, err
	}

	ch := make(chan Response, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	if err := c.writeLine(data); err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return Response{}, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return Response{}, ctx.Err()
	case <-c.done:
		return Response{}, errors.New("pi process exited")
	}
}

// CallData is Call plus success/error unwrapping: it returns resp.Data or an
// error when the command failed.
func (c *Client) CallData(ctx context.Context, cmdType string, fields map[string]any) (json.RawMessage, error) {
	resp, err := c.Call(ctx, cmdType, fields)
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		if resp.Error != "" {
			return nil, errors.New(resp.Error)
		}
		return nil, fmt.Errorf("pi command %q failed", cmdType)
	}
	return resp.Data, nil
}

// Stop shuts the subprocess down: close stdin (pi exits on EOF), wait
// briefly, then kill.
func (c *Client) Stop() {
	c.writeMu.Lock()
	_ = c.stdin.Close()
	c.writeMu.Unlock()
	select {
	case <-c.done:
		return
	case <-time.After(3 * time.Second):
	}
	_ = c.cmd.Process.Kill()
	select {
	case <-c.done:
	case <-time.After(2 * time.Second):
	}
}
