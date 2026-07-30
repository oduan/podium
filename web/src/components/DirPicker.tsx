import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { FileEntry } from "../types";
import { FolderIcon } from "./Icons";

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
      setError(loadError instanceof Error ? loadError.message : "无法读取目录");
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
    <div className="dir-picker">
      <div className="dir-picker-header">
        <button
          type="button"
          onClick={goUp}
          disabled={!rel || loading}
          className="text-button"
        >
          上一级
        </button>
        <span className="dir-picker-path">{abs || root || "正在读取…"}</span>
      </div>

      <div className="dir-picker-list">
        {error && <p className="dir-picker-message error">{error}</p>}
        {!error && loading && <p className="dir-picker-message">正在读取目录…</p>}
        {!error && !loading && entries.length === 0 && (
          <p className="dir-picker-message">当前目录没有子目录</p>
        )}
        {!loading &&
          entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void load(entry.path)}
              className="dir-entry"
            >
              <FolderIcon />
              <span className="truncate">{entry.name}</span>
            </button>
          ))}
      </div>

      <div className="dir-picker-footer">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn">
            取消
          </button>
        )}
        <button
          type="button"
          onClick={() => abs && onSelect(abs)}
          disabled={!abs || loading}
          className="btn btn-primary"
        >
          使用此目录
        </button>
      </div>
    </div>
  );
}
