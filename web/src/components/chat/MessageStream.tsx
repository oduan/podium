import { useEffect, useRef, useState } from "react";
import type { AssistantItem, ChatItem } from "../../stores/chatModel";
import { ChevronDownIcon, PodiumIcon } from "../Icons";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="thinking-block">
      <button type="button" onClick={() => setOpen((value) => !value)} className="thinking-toggle" aria-expanded={open}>
        <ChevronDownIcon style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        推理过程
      </button>
      {open && <pre className="thinking-copy">{text}</pre>}
    </div>
  );
}

function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <article className="message assistant-message">
      <div className="message-meta">
        <span className="avatar"><PodiumIcon /></span>
        <span>Podium Agent</span>
        {item.streaming && <span>正在回复</span>}
      </div>
      <div className="assistant-copy">
        <ThinkingBlock text={item.thinking} />
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
