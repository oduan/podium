// sessionStore owns the live state and WebSocket for the currently open
// session. A lifecycle generation prevents stale async work from one route or
// React StrictMode mount from mutating the next session.
import { create } from "zustand";
import { api } from "../api/client";
import { SessionSocket, type WsStatus } from "../api/socket";
import { applyEvent, buildItemsFromEntries, finalizeTurn, type ChatItem } from "./chatModel";
import type { PiEvent, PromptImage, SessionState, SessionStats } from "../types";

export interface ExtensionUiRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

export interface Toast {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
}

interface SessionStoreState {
  sessionId: string | null;
  wsStatus: WsStatus;
  processStatus: string;
  items: ChatItem[];
  streamingAssistantId: string | null;
  isStreaming: boolean;
  lastEntryId: string | null;
  queue: { steering: string[]; followUp: string[] };
  state: SessionState | null;
  stats: SessionStats | null;
  uiRequest: ExtensionUiRequest | null;
  toasts: Toast[];
  compacting: boolean;

  open: (sessionId: string) => Promise<void>;
  close: () => void;
  sendPrompt: (
    message: string,
    images?: PromptImage[],
    streamingBehavior?: "steer" | "followUp",
  ) => boolean;
  abort: () => boolean;
  compact: () => boolean;
  setModel: (provider: string, modelId: string) => boolean;
  setThinkingLevel: (level: string) => boolean;
  setSessionName: (name: string) => boolean;
  answerUi: (response: object) => boolean;
  dismissToast: (id: number) => void;
  refreshStats: () => Promise<void>;
}

type StoreSet = (partial: Partial<SessionStoreState>) => void;
type StoreGet = () => SessionStoreState;

let socket: SessionSocket | null = null;
let lifecycle = 0;
let commandSeq = 0;
let toastSeq = 0;
let syncingGeneration: number | null = null;
let queuedChatEvents: PiEvent[] = [];
let resyncRequested = false;
let uiTimeout: number | null = null;

// Streaming deltas are batched into a single render pass instead of one React
// render per event, so bursts of tool output or thinking updates cannot
// overwhelm the browser (which would otherwise drop the socket server-side).
const CHAT_BATCH_MS = 32;
let pendingChatEvents: PiEvent[] = [];
let pendingFlushTimer: number | null = null;

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessionId: null,
  wsStatus: "closed",
  processStatus: "unknown",
  items: [],
  streamingAssistantId: null,
  isStreaming: false,
  lastEntryId: null,
  queue: { steering: [], followUp: [] },
  state: null,
  stats: null,
  uiRequest: null,
  toasts: [],
  compacting: false,

  open: async (sessionId) => {
    const generation = ++lifecycle;
    socket?.close();
    socket = null;
    resetAsyncState();
    set({
      sessionId,
      wsStatus: "connecting",
      processStatus: "starting",
      items: [],
      streamingAssistantId: null,
      isStreaming: false,
      lastEntryId: null,
      queue: { steering: [], followUp: [] },
      state: null,
      stats: null,
      uiRequest: null,
      toasts: [],
      compacting: false,
    });

    try {
      const detail = await api.getSession(sessionId);
      if (!isCurrent(generation, sessionId, get)) return;
      set({ state: detail.state ?? null, stats: detail.stats ?? null });
    } catch (error) {
      if (isCurrent(generation, sessionId, get)) {
        pushToast(get, set, "warning", errorMessage(error, "Failed to load session state"));
      }
    }
	if (!isCurrent(generation, sessionId, get)) return;
    await syncHistory(sessionId, generation, set, get);
    if (!isCurrent(generation, sessionId, get)) return;

    const nextSocket = new SessionSocket(sessionId, {
      onStatus: (status) => {
        if (isCurrent(generation, sessionId, get) && socket === nextSocket) {
          // Don't lose the last batch of deltas when the socket drops.
          if (status === "closed") flushPendingChatEvents();
          set({ wsStatus: status });
        }
      },
      onEvent: (event) => {
        if (isCurrent(generation, sessionId, get) && socket === nextSocket) {
          handleEvent(event, sessionId, generation, set, get);
        }
      },
      onReconnect: () => {
        if (isCurrent(generation, sessionId, get) && socket === nextSocket) {
          void syncHistory(sessionId, generation, set, get);
        }
      },
    });
    socket = nextSocket;
    nextSocket.connect();
  },

  close: () => {
    lifecycle++;
    socket?.close();
    socket = null;
    resetAsyncState();
    set({
      sessionId: null,
      wsStatus: "closed",
      processStatus: "unknown",
      items: [],
      streamingAssistantId: null,
      isStreaming: false,
      lastEntryId: null,
      queue: { steering: [], followUp: [] },
      state: null,
      stats: null,
      uiRequest: null,
      compacting: false,
    });
  },

  sendPrompt: (message, images, streamingBehavior) => {
	if (message.length > 256 * 1024) {
	  pushToast(get, set, "error", "Message is larger than the 256 KiB limit.");
	  return false;
	}
    const id = nextCommandId();
    const command: Record<string, unknown> = { id, type: "prompt", message };
    if (images?.length) {
      command.images = images.map(({ data, mimeType }) => ({ type: "image", data, mimeType }));
    }
    if (streamingBehavior) command.streamingBehavior = streamingBehavior;
    if (!send(command, get, set)) return false;
    set({
      items: [
        ...get().items,
        {
          kind: "user",
          id: `local-${id}`,
          text: message || `🖼 ${images?.length ?? 0} image${images?.length === 1 ? "" : "s"}`,
        },
      ],
    });
    return true;
  },

  abort: () => send({ id: nextCommandId(), type: "abort" }, get, set),

  compact: () => send({ id: nextCommandId(), type: "compact" }, get, set),

  setModel: (provider, modelId) =>
    send({ id: nextCommandId(), type: "set_model", provider, modelId }, get, set),

  setThinkingLevel: (level) =>
    send({ id: nextCommandId(), type: "set_thinking_level", level }, get, set),

  setSessionName: (name) =>
    send({ id: nextCommandId(), type: "set_session_name", name }, get, set),

  answerUi: (response) => {
    if (!send(response, get, set)) return false;
    clearUiTimeout();
    set({ uiRequest: null });
    return true;
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

  refreshStats: async () => {
    const id = get().sessionId;
    const generation = lifecycle;
    if (!id) return;
    try {
      const detail = await api.getSession(id);
      if (!isCurrent(generation, id, get)) return;
      set({ state: detail.state ?? get().state, stats: detail.stats ?? get().stats });
    } catch (error) {
      if (isCurrent(generation, id, get)) {
        pushToast(get, set, "warning", errorMessage(error, "Failed to refresh session state"));
      }
    }
  },
}));

async function syncHistory(
  sessionId: string,
  generation: number,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
	if (!isCurrent(generation, sessionId, get)) return;
  if (syncingGeneration === generation) {
    resyncRequested = true;
    return;
  }
  syncingGeneration = generation;
  try {
    do {
      resyncRequested = false;
      let result: Awaited<ReturnType<typeof api.getEntries>>;
      try {
        result = await api.getEntries(sessionId);
      } catch (error) {
        if (isCurrent(generation, sessionId, get)) {
          pushToast(get, set, "warning", errorMessage(error, "Failed to synchronize conversation history"));
          replayQueuedEvents(set, get);
        }
        return;
      }
      if (!isCurrent(generation, sessionId, get)) return;
      if (resyncRequested) {
        queuedChatEvents = [];
        continue;
      }

      let items = buildItemsFromEntries(result.entries, result.leafId);
      // A reconnect during an active turn can happen before pi durably appends
      // the prompt. Preserve only unmatched optimistic messages in that case.
      if (get().isStreaming) items = mergePendingLocalItems(items, get().items);
      let streamingAssistantId: string | null = null;
      for (const event of queuedChatEvents) {
        const applied = applyEvent(items, streamingAssistantId, event);
        items = applied.items;
        streamingAssistantId = applied.streamingAssistantId;
      }
      queuedChatEvents = [];
      set({ items, streamingAssistantId, lastEntryId: result.leafId });
    } while (resyncRequested && isCurrent(generation, sessionId, get));
  } finally {
    if (syncingGeneration === generation) {
      syncingGeneration = null;
      queuedChatEvents = [];
      resyncRequested = false;
    }
  }
}

function mergePendingLocalItems(durable: ChatItem[], current: ChatItem[]): ChatItem[] {
  const counts = new Map<string, number>();
  for (const item of durable) {
    if (item.kind === "user") counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
  }
  const pending: ChatItem[] = [];
  for (const item of current) {
    if (item.kind !== "user" || !item.id.startsWith("local-")) continue;
    const count = counts.get(item.text) ?? 0;
    if (count > 0) counts.set(item.text, count - 1);
    else pending.push(item);
  }
  return [...durable, ...pending];
}

function replayQueuedEvents(set: StoreSet, get: StoreGet) {
  let items = get().items;
  let streamingAssistantId = get().streamingAssistantId;
  for (const event of queuedChatEvents) {
    const applied = applyEvent(items, streamingAssistantId, event);
    items = applied.items;
    streamingAssistantId = applied.streamingAssistantId;
  }
  queuedChatEvents = [];
  set({ items, streamingAssistantId });
}

function handleEvent(
  event: PiEvent,
  sessionId: string,
  generation: number,
  set: StoreSet,
  get: StoreGet,
) {
  switch (event.type) {
    case "process_status": {
      const status = String(event.status ?? "unknown");
      set({ processStatus: status });
      if (status === "error") {
        const raw = String(event.error ?? "unknown");
        // A dropped event stream while pi is still running is transient: the
        // socket reconnects and resyncs from durable entries automatically.
        const message = raw.includes("event consumer is too slow")
          ? "连接繁忙，正在自动重连并同步…"
          : `Process error: ${raw}`;
        pushToast(get, set, "warning", message);
      }
      return;
    }
    case "agent_start":
      set({ isStreaming: true });
      return;
	case "agent_end":
	  // A retry, compaction retry, or queued continuation may still follow.
	  return;
    case "agent_settled": {
      // Apply any batched chat events first, then settle the open turn so the
      // process header stops ticking before durable history replaces it.
      flushPendingChatEvents();
      const settled = finalizeTurn(get().items, get().streamingAssistantId);
      set({ isStreaming: false, items: settled.items, streamingAssistantId: settled.streamingAssistantId });
      void get().refreshStats();
      void syncHistory(sessionId, generation, set, get);
      return;
    }
    case "queue_update":
      set({
        queue: {
		  steering: ((event.steering ?? []) as string[]).slice(-100),
		  followUp: ((event.followUp ?? []) as string[]).slice(-100),
        },
      });
      return;
    case "auto_compaction_start":
    case "compaction_start":
      set({ compacting: true });
      pushToast(get, set, "info", "Compacting conversation context…");
      return;
    case "auto_compaction_end":
    case "compaction_end":
      set({ compacting: false });
      return;
    case "auto_retry_start":
      pushToast(get, set, "warning", `Retrying after transient error (attempt ${String(event.attempt ?? "?")})…`);
      return;
    case "extension_ui_request": {
      const method = String(event.method);
      if (["select", "confirm", "input", "editor"].includes(method)) {
        const request = event as unknown as ExtensionUiRequest;
        set({ uiRequest: request });
        scheduleUiTimeout(request, get, set);
      } else if (method === "notify") {
        const level = ["info", "warning", "error"].includes(String(event.notifyType))
          ? (event.notifyType as Toast["level"])
          : "info";
        pushToast(get, set, level, String(event.message ?? ""));
      }
      return;
    }
    case "response": {
      const command = String(event.command ?? "command");
      if (event.success === false) {
        const id = String(event.id ?? "");
        if (command === "prompt" && id) {
          set({ items: get().items.filter((item) => item.id !== `local-${id}`) });
        }
        pushToast(get, set, "error", `${command} failed: ${String(event.error ?? "unknown error")}`);
      } else if (["set_model", "set_thinking_level", "cycle_model", "set_session_name", "compact"].includes(command)) {
        void get().refreshStats();
      }
      return;
    }
    default:
      break;
  }

  if (isChatEvent(event)) {
    if (syncingGeneration === generation) {
      if (queuedChatEvents.length >= 2048) {
        queuedChatEvents = [];
        resyncRequested = true;
      } else {
        queuedChatEvents.push(event);
      }
      return;
    }
    pendingChatEvents.push(event);
    if (pendingFlushTimer === null) {
      pendingFlushTimer = window.setTimeout(flushPendingChatEvents, CHAT_BATCH_MS);
    }
  }
}

function flushPendingChatEvents() {
  pendingFlushTimer = null;
  const events = pendingChatEvents;
  pendingChatEvents = [];
  if (events.length === 0) return;
  const { items, streamingAssistantId } = useSessionStore.getState();
  let nextItems = items;
  let nextStreamingId = streamingAssistantId;
  for (const event of events) {
    const applied = applyEvent(nextItems, nextStreamingId, event);
    nextItems = applied.items;
    nextStreamingId = applied.streamingAssistantId;
  }
  useSessionStore.setState({ items: nextItems, streamingAssistantId: nextStreamingId });
}

function isChatEvent(event: PiEvent): boolean {
  return [
    "message_start",
    "message_update",
    "message_update_error",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
  ].includes(event.type);
}

function scheduleUiTimeout(request: ExtensionUiRequest, get: StoreGet, set: StoreSet) {
  clearUiTimeout();
  if (!request.timeout || request.timeout <= 0) return;
  uiTimeout = window.setTimeout(() => {
    uiTimeout = null;
    if (get().uiRequest?.id !== request.id) return;
	// Pi resolves timed dialogs on the agent side. Only dismiss the stale
	// local modal; sending a second response would race that resolution.
    set({ uiRequest: null });
    pushToast(get, set, "warning", "Extension prompt timed out");
	}, request.timeout + 100);
}

function clearUiTimeout() {
  if (uiTimeout !== null) window.clearTimeout(uiTimeout);
  uiTimeout = null;
}

function resetAsyncState() {
  clearUiTimeout();
  if (pendingFlushTimer !== null) {
    window.clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  pendingChatEvents = [];
  syncingGeneration = null;
  queuedChatEvents = [];
  resyncRequested = false;
}

function isCurrent(generation: number, sessionId: string, get: StoreGet): boolean {
  return generation === lifecycle && get().sessionId === sessionId;
}

function nextCommandId(): string {
  return `web-${Date.now().toString(36)}-${++commandSeq}`;
}

function send(command: object, get: StoreGet, set: StoreSet): boolean {
  if (socket?.send(command)) return true;
  pushToast(get, set, "error", "Not connected. Your action was not sent.");
  return false;
}

function pushToast(get: StoreGet, set: StoreSet, level: Toast["level"], message: string) {
  const text = message.slice(0, 4096);
  // Identical notifications collapse into one; refreshing it restarts the
  // auto-dismiss timer instead of stacking another toast.
  const existing = get().toasts.find((toast) => toast.level === level && toast.message === text);
  const id = existing?.id ?? ++toastSeq;
  set({
    toasts: existing
      ? get().toasts.map((toast) => (toast.id === existing.id ? { ...toast, level, message: text } : toast))
      : [...get().toasts, { id, level, message: text }].slice(-50),
  });
  window.setTimeout(() => {
    useSessionStore.setState((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  }, level === "error" ? 8000 : 5000);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
