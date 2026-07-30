import { useEffect, useRef, useState } from "react";
import type { AssistantItem, ChatItem } from "../../stores/chatModel";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-ink-500 hover:text-ink-300"
      >
        {open ? "▾" : "▸"} thinking
      </button>
      {open && (
        <pre className="mt-1 text-xs text-ink-400 whitespace-pre-wrap border-l-2 border-ink-700 pl-3">
          {text}
        </pre>
      )}
    </div>
  );
}

function AssistantBubble({ item }: { item: AssistantItem }) {
  return (
    <div className="max-w-none">
      <ThinkingBlock text={item.thinking} />
      {item.text ? (
        <Markdown text={item.text} />
      ) : (
        item.streaming && <span className="text-ink-500 text-sm">▍</span>
      )}
      {item.error && <p className="text-red-400 text-sm mt-1">{item.error}</p>}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-accent-soft/20 border border-accent-soft/30 rounded-2xl rounded-br-sm px-4 py-2 text-ink-100 whitespace-pre-wrap">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === "tool") return <ToolCard tool={item} />;
  return <AssistantBubble item={item} />;
}

// MessageStream renders the ordered chat items and keeps the view pinned to the
// bottom while the user is already near the bottom.
export function MessageStream({ items }: { items: ChatItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
	const visibleItems = items.slice(-1000);

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [items]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  return (
    <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        {items.length === 0 && (
          <p className="text-center text-ink-500 mt-10">Send a message to start.</p>
        )}
		{items.length > visibleItems.length && (
		  <p className="text-center text-xs text-ink-500">
			{items.length - visibleItems.length} older items are hidden to keep this view responsive.
		  </p>
		)}
		{visibleItems.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
