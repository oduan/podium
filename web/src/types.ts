// Shared types mirroring the Go API and pi RPC event/entry shapes.

export interface SessionView {
  id: string;
  name: string;
  cwd: string;
  piSessionFile?: string;
  isWorkspace: boolean;
  createdAt: string;
  lastActiveAt: string;
  running: boolean;
  pending: boolean;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface SessionState {
  model: Model | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  messageCount: number;
  pendingMessageCount: number;
}

export interface SessionStats {
  tokens?: { total?: number };
  cost?: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface MaskedKey {
  provider: string;
  envVar: string;
  masked: string;
}

export interface PromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

// pi message content blocks.
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

export interface PiMessage {
  role: "user" | "assistant" | "toolResult" | "bashExecution" | string;
  content: string | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  command?: string;
  output?: string;
  timestamp?: number;
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: PiMessage;
}

// A pi RPC event (loosely typed; we switch on `type`).
export interface PiEvent {
  type: string;
  [k: string]: unknown;
}
