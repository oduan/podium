import { useEffect, useRef, useState } from "react";
import type { AssistantItem, ChatItem, ToolItem } from "../../stores/chatModel";
import { CheckIcon, ChevronDownIcon, CloseIcon, PodiumIcon } from "../Icons";
import { Markdown } from "./Markdown";
import { DiffView, summarizeArgs, ToolCard } from "./ToolCard";

// One thinking segment: collapsed to a single preview line by default, like
// pi's CLI which hides thinking behind a one-line italic label. Clicking the
// line expands it to a scrollable view of roughly eight lines.
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

  if (!expandable) {
    return (
      <div className="exec-line think-line" title={text}>
        <span className="exec-line-text">{preview}</span>
      </div>
    );
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
        <ChevronDownIcon className="icon exec-chevron" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        <span className="exec-line-text">{preview}</span>
      </button>
      {open && (
        <pre ref={scrollRef} className="think-full">
          {text}
        </pre>
      )}
    </div>
  );
}

// One tool call: a single line by default. Clicking it expands the output or
// diff below (scrollable); while the tool is still running the expanded view
// follows the live output.
function ToolLine({ tool, streaming }: { tool: ToolItem; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  const subtitle = summarizeArgs(tool.name, tool.args);
  const hasBody = Boolean(tool.output || tool.diff);

  useEffect(() => {
    if (open && streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tool.output, tool.diff, open, streaming]);

  const body = tool.diff ? (
    <DiffView diff={tool.diff} />
  ) : tool.output ? (
    <pre ref={scrollRef} className={`exec-tool-output${tool.isError ? " error" : ""}`}>{tool.output}</pre>
  ) : null;

  const line = (
    <>
      {tool.running ? (
        <span className="tool-spinner" />
      ) : tool.isError ? (
        <CloseIcon className="icon exec-tool-state error" />
      ) : (
        <CheckIcon className="icon exec-tool-state" />
      )}
      <span className="exec-tool-name">{tool.name}</span>
      {subtitle && <span className="exec-tool-detail">{subtitle}</span>}
      {hasBody && (
        <ChevronDownIcon className="icon exec-chevron" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
      )}
    </>
  );

  return (
    <div className={`tool-entry${open ? " open" : ""}`}>
      {hasBody ? (
        <button
          type="button"
          className="exec-line tool-line tool-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={subtitle}
        >
          {line}
        </button>
      ) : (
        <div className="exec-line tool-line" title={subtitle}>{line}</div>
      )}
      {open && body}
    </div>
  );
}

// The execution log renders a turn's thinking segments and tool calls as one
// compact small-font line each, in the order they happened.
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

function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <article className="message assistant-message">
      <div className="assistant-copy">
        <ExecutionLog item={item} />
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
