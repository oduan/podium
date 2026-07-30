// WebSocket client for a session: streams pi events, sends commands, and
// auto-reconnects. On reconnect the consumer is notified so it can resync the
// durable active branch over REST.
import { getToken } from "./client";
import type { PiEvent } from "../types";

export type WsStatus = "connecting" | "open" | "closed";

const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

interface Handlers {
  onEvent: (event: PiEvent) => void;
  onStatus: (status: WsStatus) => void;
  onReconnect: () => void;
}

export class SessionSocket {
  private sessionId: string;
  private handlers: Handlers;
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retry = 0;
  private hadConnection = false;
  private reconnectTimer: number | null = null;

  constructor(sessionId: string, handlers: Handlers) {
    this.sessionId = sessionId;
    this.handlers = handlers;
  }

  connect() {
	if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closedByUser = false;
    this.open();
  }

  private open() {
	if (this.closedByUser) return;
	if (this.reconnectTimer !== null) {
	  window.clearTimeout(this.reconnectTimer);
	  this.reconnectTimer = null;
	}
    this.handlers.onStatus("connecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const token = encodeURIComponent(getToken());
    const url = `${proto}//${location.host}/api/sessions/${encodeURIComponent(this.sessionId)}/ws?token=${token}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
	  if (this.ws !== ws || this.closedByUser) return;
      this.retry = 0;
      this.handlers.onStatus("open");
      if (this.hadConnection) this.handlers.onReconnect();
      this.hadConnection = true;
    };
    ws.onmessage = (ev) => {
	  if (this.ws !== ws || this.closedByUser) return;
      try {
        this.handlers.onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
	  if (this.ws !== ws) return;
	  this.ws = null;
      this.handlers.onStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
	  if (this.ws === ws) ws.close();
    };
  }

  private scheduleReconnect() {
	if (this.closedByUser || this.reconnectTimer !== null) return;
    const delay = Math.min(1000 * 2 ** this.retry, 15000);
    this.retry++;
	this.reconnectTimer = window.setTimeout(() => {
	  this.reconnectTimer = null;
	  this.open();
	}, delay);
  }

  send(command: object): boolean {
	if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
	  try {
		this.ws.send(JSON.stringify(command));
		return true;
	  } catch {
		return false;
	  }
    }
	return false;
  }

  close() {
    this.closedByUser = true;
	if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
	this.reconnectTimer = null;
	const ws = this.ws;
    this.ws = null;
	ws?.close();
  }
}
