package pirpc

import (
	"bufio"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestReadLineHandlesCRLFAndEnforcesLimit(t *testing.T) {
	line, err := readLine(bufio.NewReader(strings.NewReader("{\"ok\":true}\r\n")))
	if err != nil || string(line) != `{"ok":true}` {
		t.Fatalf("readLine() = %q, %v", line, err)
	}
	tooLarge := strings.Repeat("x", maxRPCLineSize+1) + "\n"
	_, err = readLine(bufio.NewReaderSize(strings.NewReader(tooLarge), 64*1024))
	if err == nil || errors.Is(err, bufio.ErrBufferFull) {
		t.Fatalf("oversized record error = %v", err)
	}
}

func TestSlowSubscriberIsClosedAtBound(t *testing.T) {
	subscriber := newSubscriber()
	dropped := false
	for i := 0; i < maxSubscriberEvents+64; i++ {
		if !subscriber.push([]byte(`{"type":"event"}`)) {
			dropped = true
			break
		}
	}
	if !dropped {
		t.Fatal("slow subscriber was allowed to grow beyond its event bound")
	}
	deadline := time.After(time.Second)
	for {
		select {
		case _, ok := <-subscriber.out:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("closed subscriber did not terminate")
		}
	}
}
