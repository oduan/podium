import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { FileEntry } from "../types";

// DirPicker browses server directories without implicitly selecting one.
// The user confirms the currently displayed folder explicitly.
export function DirPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (abs: string) => void;
  onCancel?: () => void;
}) {
  const [rel, setRel] = useState("");
  const [abs, setAbs] = useState("");
  const [root, setRoot] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.browseDirs(path);
      setRel(result.path);
      setAbs(result.abs);
      setRoot(result.root);
      setEntries(result.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to browse folders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
  }, []);

  const goUp = () => {
    if (!rel) return;
    void load(rel.split("/").slice(0, -1).join("/"));
  };

  return (
    <div className="ml-[4.75rem] overflow-hidden rounded-lg border border-white/[0.08] bg-ink-900 animate-slide-up">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <button
          type="button"
          onClick={goUp}
          disabled={!rel || loading}
          className="rounded px-2 py-1 text-xs text-ink-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
        >
          Up
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500">{abs || root || "Loading…"}</span>
      </div>

      <div className="max-h-44 overflow-y-auto py-1">
        {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
        {!error && loading && <p className="px-3 py-2 text-xs text-ink-500">Loading folders…</p>}
        {!error && !loading && entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-500">No subfolders</p>
        )}
        {!loading &&
          entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void load(entry.path)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-300 transition hover:bg-white/[0.045] hover:text-white"
            >
              <span className="text-ink-600">▸</span>
              <span className="truncate">{entry.name}</span>
            </button>
          ))}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-3 py-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-2 py-1 text-xs text-ink-500 transition hover:text-white">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => abs && onSelect(abs)}
          disabled={!abs || loading}
          className="rounded-md bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-accent disabled:opacity-40"
        >
          Use this folder
        </button>
      </div>
    </div>
  );
}
