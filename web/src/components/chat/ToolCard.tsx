import { useEffect, useRef, useState } from "react";
import type { ToolItem } from "../../stores/chatModel";
import { ChevronDownIcon } from "../Icons";

export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="exec-body">
      {diff.split("\n").map((line, index) => {
        let className = "diff-line";
        if (line.startsWith("+") && !line.startsWith("+++")) className += " add";
        else if (line.startsWith("-") && !line.startsWith("---")) className += " remove";
        else if (line.startsWith("@@")) className += " hunk";
        return <span key={index} className={className}>{line || " "}</span>;
      })}
    </pre>
  );
}

export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const stringValue = (key: string) => typeof args[key] === "string" ? String(args[key]) : "";
  switch (name) {
    case "bash":
      return stringValue("command");
    case "read":
    case "write":
    case "edit":
      return stringValue("path") || stringValue("file") || stringValue("filePath");
    default: {
      const first = Object.values(args)[0];
      return typeof first === "string" ? first : "";
    }
  }
}

// Compact trailing metadata for a collapsed tool line: diff stats for edits,
// output line count for everything else.
function toolMeta(tool: ToolItem): string {
  if (tool.diff) {
    let add = 0;
    let remove = 0;
    for (const line of tool.diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) add++;
      else if (line.startsWith("-") && !line.startsWith("---")) remove++;
    }
    return `+${add} −${remove}`;
  }
  if (tool.output) {
    const count = tool.output.trimEnd().split("\n").length;
    return count > 1 ? `${count} 行` : "";
  }
  return "";
}

// One tool call rendered as a uniform grid row (name + args · meta +
// chevron); failures tint the tool name red instead of a leading icon.
// Clicking expands the output or diff below; while the tool is still
// running the expanded view follows the live output.
export function ToolLine({ tool, streaming }: { tool: ToolItem; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  const subtitle = summarizeArgs(tool.name, tool.args);
  const hasBody = Boolean(tool.output || tool.diff);
  const meta = toolMeta(tool);

  useEffect(() => {
    if (open && streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tool.output, tool.diff, open, streaming]);

  const body = tool.diff ? (
    <DiffView diff={tool.diff} />
  ) : tool.output ? (
    <pre ref={scrollRef} className={`exec-body${tool.isError ? " error" : ""}`}>{tool.output}</pre>
  ) : null;

  const row = (
    <>
      <span className="exec-main">
        <span className={`exec-tool-name${tool.isError ? " error" : ""}`}>{tool.name}</span>
        {subtitle && <span className="exec-tool-detail">{subtitle}</span>}
      </span>
      <span className="exec-tail">
        {tool.running && <span className="tool-spinner" />}
        {meta && <span className="exec-meta">{meta}</span>}
        {hasBody && (
          <ChevronDownIcon className="icon exec-chevron" style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        )}
      </span>
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
          {row}
        </button>
      ) : (
        <div className="exec-line tool-line" title={subtitle}>{row}</div>
      )}
      {open && body}
    </div>
  );
}

// Top-level tool executions (e.g. persisted bash runs) share the exact same
// compact row as in-turn tool calls so the timeline stays uniform.
export function ToolCard({ tool }: { tool: ToolItem }) {
  return (
    <article className="message tool-message">
      <div className="exec-log">
        <ToolLine tool={tool} streaming={tool.running} />
      </div>
    </article>
  );
}
