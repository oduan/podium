import { useSessionStore } from "../stores/sessionStore";

// Toasts renders transient notifications (compaction, retries, notify events,
// process errors) pushed into the session store.
export function Toasts() {
  const toasts = useSessionStore((s) => s.toasts);
  const dismiss = useSessionStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.level}`}>
          <span className={`status-dot ${toast.level === "error" ? "error" : toast.level === "warning" ? "connecting" : "live"}`} />
          <span className="toast-content">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="toast-close"
            aria-label="关闭通知"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
