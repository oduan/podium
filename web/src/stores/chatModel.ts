// Chat model: normalizes pi session entries and streaming events into a flat
// list of renderable items (user / assistant / tool call).
import type { ContentBlock, PiEvent, PiMessage, SessionEntry } from "../types";

export interface UserItem {
  kind: "user";
  id: string;
  text: string;
  timestamp?: number;
}

export interface AssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  thinking: string;
  streaming: boolean;
  error?: string;
  timestamp?: number;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  output: string;
  running: boolean;
  isError: boolean;
  diff?: string;
}

export type ChatItem = UserItem | AssistantItem | ToolItem;

function textFromContent(content: string | ContentBlock[]): {
  text: string;
  thinking: string;
  tools: ToolItem[];
} {
  if (typeof content === "string") return { text: content, thinking: "", tools: [] };
  let text = "";
  let thinking = "";
  let imageCount = 0;
  const tools: ToolItem[] = [];
  for (const block of content) {
	const raw = block as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      thinking += block.thinking;
    } else if (block.type === "image") {
      imageCount++;
    } else if (block.type === "toolCall") {
	  if (typeof raw.id !== "string" || typeof raw.name !== "string") continue;
      tools.push({
        kind: "tool",
		id: raw.id,
		name: raw.name,
		args: isRecord(raw.arguments) ? raw.arguments : {},
        output: "",
        running: false,
        isError: false,
      });
    }
  }
  if (imageCount > 0) text += `${text ? "\n" : ""}🖼 ${imageCount} image${imageCount > 1 ? "s" : ""}`;
  return { text, thinking, tools };
}

function extractToolResultText(content: PiMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
	.map((b) => {
	  const text = (b as Record<string, unknown>).text;
	  return typeof text === "string" ? text : "";
	})
    .join("");
}

// get_entries includes abandoned branches. Follow parentId from leafId so the
// UI renders only the active conversation branch, in chronological order.
export function activeBranchEntries(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
  if (!leafId) return entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  const seen = new Set<string>();
  let id: string | null = leafId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    branch.push(entry);
    id = entry.parentId;
  }
  return branch.reverse();
}

// buildItemsFromEntries converts the durable active branch into chat items.
export function buildItemsFromEntries(entries: SessionEntry[], leafId: string | null = null): ChatItem[] {
  const items: ChatItem[] = [];
  const toolIndex = new Map<string, ToolItem>();

  for (const entry of activeBranchEntries(entries, leafId)) {
    const msg = entry.message;
    if (!msg) continue;
    const ts = msg.timestamp;
    switch (msg.role) {
      case "user": {
        const { text } = textFromContent(msg.content);
        if (text.trim()) items.push({ kind: "user", id: entry.id, text, timestamp: ts });
        break;
      }
      case "assistant": {
        const { text, thinking, tools } = textFromContent(msg.content);
        if (text || thinking) {
          items.push({ kind: "assistant", id: entry.id, text, thinking, streaming: false, timestamp: ts });
        }
        for (const tool of tools) {
          items.push(tool);
          toolIndex.set(tool.id, tool);
        }
        break;
      }
      case "toolResult": {
        const tool = msg.toolCallId ? toolIndex.get(msg.toolCallId) : undefined;
        if (tool) {
          tool.output = extractToolResultText(msg.content);
          tool.isError = !!msg.isError;
          tool.running = false;
        }
        break;
      }
      case "bashExecution":
        items.push({
          kind: "tool",
          id: entry.id,
          name: "bash",
          args: { command: msg.command },
          output: msg.output ?? "",
          running: false,
          isError: !!msg.isError,
        });
        break;
      default:
        break;
    }
  }
  return items;
}

export interface ApplyResult {
  items: ChatItem[];
  streamingAssistantId: string | null;
}

let streamCounter = 0;

export function applyEvent(
  items: ChatItem[],
  streamingAssistantId: string | null,
  event: PiEvent,
): ApplyResult {
  // Clone item objects as well as the array: Zustand subscribers must never
  // observe mutations to objects from the previous state snapshot.
  const next = items.map((item) =>
    item.kind === "tool" ? { ...item, args: { ...item.args } } : { ...item },
  ) as ChatItem[];

  const ensureAssistant = (): AssistantItem => {
    if (streamingAssistantId) {
      const found = next.find((item) => item.id === streamingAssistantId && item.kind === "assistant");
      if (found?.kind === "assistant") return found;
    }
    const item: AssistantItem = {
      kind: "assistant",
      id: `stream-${++streamCounter}`,
      text: "",
      thinking: "",
      streaming: true,
    };
    next.push(item);
    streamingAssistantId = item.id;
    return item;
  };

  const upsertTool = (id: string, name = "tool", args: Record<string, unknown> = {}): ToolItem => {
    const existing = next.find((item) => item.kind === "tool" && item.id === id);
    if (existing?.kind === "tool") return existing;
    const tool: ToolItem = { kind: "tool", id, name, args, output: "", running: false, isError: false };
    next.push(tool);
    return tool;
  };

  switch (event.type) {
    case "message_start": {
      const message = event.message as PiMessage | undefined;
      if (message?.role === "assistant") ensureAssistant();
      break;
    }
    case "message_update": {
      const update = event.assistantMessageEvent as Record<string, any> | undefined;
      if (!update) break;
      const assistant = ensureAssistant();
      if (update.type === "text_delta") assistant.text += update.delta ?? "";
      else if (update.type === "thinking_delta") assistant.thinking += update.delta ?? "";
      else if (update.type === "error") {
		assistant.error = errorText(update.error ?? update.message ?? update.reason ?? "Assistant stream failed");
        assistant.streaming = false;
      } else if (update.type === "toolcall_end" && update.toolCall) {
        const call = update.toolCall;
        const tool = upsertTool(call.id, call.name, call.arguments ?? {});
        tool.name = call.name;
        tool.args = call.arguments ?? {};
      }
      break;
    }
    case "message_update_error": {
      const assistant = ensureAssistant();
      assistant.error = errorText(event.error ?? "Assistant stream failed");
      assistant.streaming = false;
      break;
    }
    case "message_end": {
      const message = event.message as PiMessage | undefined;
      if (!message || message.role === "assistant") {
        const assistant = ensureAssistant();
        if (message?.role === "assistant") {
          const final = textFromContent(message.content);
          assistant.text = final.text;
          assistant.thinking = final.thinking;
          assistant.timestamp = message.timestamp;
          for (const tool of final.tools) {
            const current = upsertTool(tool.id, tool.name, tool.args);
            current.name = tool.name;
            current.args = tool.args;
          }
        }
        assistant.streaming = false;
        streamingAssistantId = null;
      }
      break;
    }
    case "tool_execution_start": {
      const id = String(event.toolCallId ?? "");
      if (!id) break;
      const tool = upsertTool(id, String(event.toolName ?? "tool"), (event.args ?? {}) as Record<string, unknown>);
      tool.running = true;
      tool.name = String(event.toolName ?? tool.name);
      tool.args = (event.args ?? tool.args) as Record<string, unknown>;
      break;
    }
    case "tool_execution_update": {
      const id = String(event.toolCallId ?? "");
      if (!id) break;
      upsertTool(id).output = extractPartial(event.partialResult);
      break;
    }
    case "tool_execution_end": {
      const id = String(event.toolCallId ?? "");
      if (!id) break;
      const tool = upsertTool(id);
      tool.running = false;
      tool.isError = !!event.isError;
      const result = event.result as any;
      tool.output = extractPartial(result);
      const diff = result?.details?.patch ?? result?.details?.diff;
      if (typeof diff === "string") tool.diff = diff;
      break;
    }
    default:
      break;
  }

  return { items: next, streamingAssistantId };
}

function extractPartial(result: any): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
  return "Assistant stream failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
