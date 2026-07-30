import { useState } from "react";
import type { ToolItem } from "../../stores/chatModel";

// DiffView renders a unified patch with per-line coloring.
function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="text-xs font-mono overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-2 mt-2">
      {diff.split("\n").map((line, i) => {
        let cls = "text-ink-400";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-emerald-400";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400";
        else if (line.startsWith("@@")) cls = "text-accent";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "bash":
      return s("command");
    case "read":
    case "write":
    case "edit":
      return s("path") || s("file") || s("filePath");
    default: {
      const first = Object.values(args)[0];
      return typeof first === "string" ? first : "";
    }
  }
}

// ToolCard shows one tool invocation: a header with the tool name, a running
// spinner or done/error marker, an argument summary, and collapsible output
// (or a diff for edit tools).
export function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const subtitle = summarizeArgs(tool.name, tool.args);
  const hasBody = !!tool.output || !!tool.diff;

  return (
    <div className="border border-ink-700 rounded-lg bg-ink-900 my-2 overflow-hidden">
      <button
        onClick={() => hasBody && setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ink-800"
      >
        {tool.running ? (
          <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        ) : tool.isError ? (
          <span className="text-red-400">✕</span>
        ) : (
          <span className="text-emerald-400">✓</span>
        )}
        <span className="text-xs font-semibold text-ink-200 uppercase tracking-wide">
          {tool.name}
        </span>
        {subtitle && (
          <span className="text-xs text-ink-500 font-mono truncate flex-1">{subtitle}</span>
        )}
        {hasBody && <span className="text-ink-500 text-xs">{open ? "▾" : "▸"}</span>}
      </button>

      {open && tool.diff && <div className="px-3 pb-3">
        <DiffView diff={tool.diff} />
      </div>}
      {open && !tool.diff && tool.output && (
        <pre
          className={`text-xs font-mono overflow-x-auto px-3 pb-3 max-h-80 whitespace-pre-wrap ${
            tool.isError ? "text-red-300" : "text-ink-300"
          }`}
        >
          {tool.output}
        </pre>
      )}
    </div>
  );
}
