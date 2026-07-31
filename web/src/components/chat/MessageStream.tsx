import { useEffect, useRef, useState } from "react";
import type { AssistantItem, ChatItem } from "../../stores/chatModel";
import { ChevronDownIcon, PodiumIcon } from "../Icons";
import { Markdown } from "./Markdown";
import { summarizeArgs, ToolCard, ToolLine } from "./ToolCard";

// One thinking segment, sharing the exact grid of ToolLine (preview · meta +
// chevron). Collapsed to a single preview line by default, like pi's CLI;
// clicking expands it to a scrollable view.
function ThinkingSegment({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const preview = lines[0] ?? "";
  // Short single-line segments need no expansion affordance.
  const expandable = lines.length > 1 || preview.length > 80;

  useEffect(() => {
    if (open && streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, open, streaming]);

  const row = (
    <>
      <span className="exec-main">
        <span className="exec-line-text">{preview}</span>
      </span>
      {expandable && (
        <span className="exec-tail">
          {lines.length > 1 && <span className="exec-meta">{lines.length} 行</span>}
          <ChevronDownIcon className="icon exec-chevron" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        </span>
      )}
    </>
  );

  if (!expandable) {
    return <div className="exec-line think-line" title={text}>{row}</div>;
  }

  return (
    <div className={`think-segment${open ? " open" : ""}`}>
      <button
        type="button"
        className="exec-line think-line think-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={text}
      >
        {row}
      </button>
      {open && (
        <pre ref={scrollRef} className="exec-body think">
          {text}
        </pre>
      )}
    </div>
  );
}

// The execution log renders a turn's thinking segments and tool calls as one
// compact line each, in the order they happened.
function ExecutionLog({ item }: { item: AssistantItem }) {
  if (item.exec.length === 0) return null;

  return (
    <div className="exec-log">
      {item.exec.map((entry, index) => {
        if (entry.type === "think") {
          return <ThinkingSegment key={`think-${index}`} text={entry.text} streaming={item.streaming} />;
        }
        const tool = entry.tool;
        return <ToolLine key={tool.id} tool={tool} streaming={item.streaming} />;
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// The most recent exec entry, shown inline in a collapsed header while the
// turn is still streaming so live activity stays visible.
function latestActivity(item: AssistantItem): string {
  const last = item.exec[item.exec.length - 1];
  if (!last) return "";
  if (last.type === "think") {
    const lines = last.text.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }
  const args = summarizeArgs(last.tool.name, last.tool.args);
  return args ? `${last.tool.name} · ${args}` : last.tool.name;
}

// TurnProcess tucks a turn's whole execution log (thinking + tool calls)
// behind a collapsed header: elapsed time on top, a rule after it, and the
// final answer below. Expanding reveals the log between header and answer.
function TurnProcess({ item }: { item: AssistantItem }) {
  const [open, setOpen] = useState(false);
  // Re-render every second while streaming so the elapsed time ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!item.streaming) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [item.streaming]);

  if (item.exec.length === 0) return null;

  const end = item.streaming ? Date.now() : item.timestamp;
  const elapsed = item.startedAt && end && end > item.startedAt ? end - item.startedAt : undefined;
  const duration = elapsed && elapsed >= 1000 && elapsed < 86_400_000 ? formatDuration(elapsed) : "";
  const activity = item.streaming && !open ? latestActivity(item) : "";

  return (
    <div className={`turn-process${open ? " open" : ""}`}>
      <button
        type="button"
        className="turn-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="turn-label">
          {item.streaming ? "处理中" : "已处理"}
          {duration && ` ${duration}`}
        </span>
        <ChevronDownIcon className="icon exec-chevron" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        {activity && <span className="turn-activity">{activity}</span>}
      </button>
      {open && <ExecutionLog item={item} />}
    </div>
  );
}

function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <article className="message assistant-message">
      <TurnProcess item={item} />
      <div className="assistant-copy">
        {item.text ? <Markdown text={item.text} /> : item.streaming && <span className="streaming-caret" />}
        {item.error && <p className="message-error">{item.error}</p>}
      </div>
    </article>
  );
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <article className="message user-message">
        <div className="user-bubble">{item.text}</div>
      </article>
    );
  }
  if (item.kind === "tool") return <ToolCard tool={item} />;
  return <AssistantMessage item={item} />;
}

// MessageStream renders the durable and streaming timeline while preserving a
// user's manual scroll position when they inspect older messages.
export function MessageStream({ items }: { items: ChatItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);
  const visibleItems = items.slice(-1000);

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [items]);

  const onScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  return (
    <section ref={containerRef} onScroll={onScroll} className="message-region" aria-live="polite">
      <div className="message-stack">
        {items.length === 0 && (
          <div className="empty-chat">
            <div>
              <span className="empty-chat-mark"><PodiumIcon /></span>
              <p>发送一条消息开始协作。</p>
            </div>
          </div>
        )}
        {items.length > visibleItems.length && (
          <p className="history-note">为保持流畅，已隐藏 {items.length - visibleItems.length} 条较早记录。</p>
        )}
        {visibleItems.map((item) => <Item key={item.id} item={item} />)}
        <div ref={endRef} />
      </div>
    </section>
  );
}
