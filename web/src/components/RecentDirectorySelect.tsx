import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon, FolderIcon } from "./Icons";

const STORAGE_KEY = "podium-recent-workspaces";
const MAX_RECENT_DIRECTORIES = 12;

function directoryKey(value: string): string {
  const trimmed = value.trim();
  const withoutTrailingSeparator = trimmed.replace(/[\\/]+$/, "") || trimmed;
  return withoutTrailingSeparator.replace(/\\/g, "/").toLocaleLowerCase();
}

function readRecentDirectories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    return stored
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .filter((value) => {
        const key = directoryKey(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RECENT_DIRECTORIES);
  } catch {
    return [];
  }
}

function persistRecentDirectories(directories: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(directories));
  } catch {
    // Local storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function RecentDirectorySelect({
  value,
  onChange,
  onBrowse,
  onOpenChange,
}: {
  value: string;
  onChange: (directory: string) => void;
  onBrowse: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recentDirectories, setRecentDirectories] = useState(readRecentDirectories);
  const rootRef = useRef<HTMLDivElement>(null);

  const updateOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    const directory = value.trim();
    if (!directory) return;
    setRecentDirectories((previous) => {
      const key = directoryKey(directory);
      const next = [directory, ...previous.filter((item) => directoryKey(item) !== key)]
        .slice(0, MAX_RECENT_DIRECTORIES);
      persistRecentDirectories(next);
      return next;
    });
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) updateOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") updateOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const removeDirectory = (directory: string) => {
    setRecentDirectories((previous) => {
      const key = directoryKey(directory);
      const next = previous.filter((item) => directoryKey(item) !== key);
      persistRecentDirectories(next);
      return next;
    });
  };

  return (
    <div ref={rootRef} className={`recent-directory-select${open ? " open" : ""}`}>
      <button
        type="button"
        className="recent-directory-trigger"
        title={value || "首条消息时创建默认工作区"}
        aria-label="选择工作目录"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => updateOpen(!open)}
      >
        <FolderIcon />
        <span>{value || "默认工作区"}</span>
        <ChevronDownIcon className="recent-directory-chevron" />
      </button>

      {open && (
        <div className="recent-directory-menu" role="menu" aria-label="工作目录">
          <button
            type="button"
            className={`recent-directory-option default${value ? "" : " selected"}`}
            role="menuitemradio"
            aria-checked={!value}
            onClick={() => {
              onChange("");
              updateOpen(false);
            }}
          >
            <span className="recent-directory-check">{!value && <CheckIcon />}</span>
            <span className="recent-directory-label">默认工作区</span>
          </button>

          <div className="recent-directory-divider" />
          <div className="recent-directory-scroll" aria-label="最近使用的工作目录">
            {recentDirectories.length === 0 ? (
              <p className="recent-directory-empty">暂无最近使用的目录</p>
            ) : (
              recentDirectories.map((directory) => {
                const selected = directoryKey(directory) === directoryKey(value);
                return (
                  <div className={`recent-directory-row${selected ? " selected" : ""}`} key={directoryKey(directory)}>
                    <button
                      type="button"
                      className="recent-directory-option"
                      role="menuitemradio"
                      aria-checked={selected}
                      title={directory}
                      onClick={() => {
                        onChange(directory);
                        updateOpen(false);
                      }}
                    >
                      <span className="recent-directory-check">{selected && <CheckIcon />}</span>
                      <span className="recent-directory-path">{directory}</span>
                    </button>
                    <button
                      type="button"
                      className="recent-directory-remove"
                      aria-label={`从最近目录中删除 ${directory}`}
                      title="从列表中删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeDirectory(directory);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="recent-directory-divider" />
          <button
            type="button"
            className="recent-directory-browse"
            role="menuitem"
            onClick={() => {
              updateOpen(false);
              onBrowse();
            }}
          >
            <FolderIcon />
            选择其他工作目录…
          </button>
        </div>
      )}
    </div>
  );
}
