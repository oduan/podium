import { useSessionStore } from "../stores/sessionStore";

// Toasts renders transient notifications (compaction, retries, notify events,
// process errors) pushed into the session store.
export function Toasts() {
  const toasts = useSessionStore((s) => s.toasts);
  const dismiss = useSessionStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  const color: Record<string, string> = {
    info: "border-ink-600 bg-ink-800 text-ink-200",
    warning: "border-amber-600/50 bg-amber-950/40 text-amber-200",
    error: "border-red-600/50 bg-red-950/40 text-red-200",
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`border rounded-lg px-4 py-2 text-sm shadow-lg flex items-start gap-3 ${color[t.level]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-ink-400 hover:text-white leading-none"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
