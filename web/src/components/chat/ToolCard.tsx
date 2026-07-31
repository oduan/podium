import { useState } from "react";
import type { ToolItem } from "../../stores/chatModel";
import { CheckIcon, ChevronDownIcon, CloseIcon } from "../Icons";

export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="tool-output">
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

export function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const subtitle = summarizeArgs(tool.name, tool.args);
  const hasBody = Boolean(tool.output || tool.diff);

  return (
    <div className={`tool-row${open ? " open" : ""}`}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className="tool-summary"
        aria-expanded={hasBody ? open : undefined}
      >
        {tool.running ? (
          <span className="tool-spinner" />
        ) : tool.isError ? (
          <CloseIcon className="icon tool-state error" />
        ) : (
          <CheckIcon className="icon tool-state" />
        )}
        <span>
          <span className="tool-name">{tool.name}</span>
          {subtitle && <span className="tool-detail">{subtitle}</span>}
        </span>
        {hasBody ? <ChevronDownIcon className="icon tool-chevron" /> : <span />}
      </button>

      {open && tool.diff && <DiffView diff={tool.diff} />}
      {open && !tool.diff && tool.output && (
        <pre className={`tool-output${tool.isError ? " error" : ""}`}>{tool.output}</pre>
      )}
    </div>
  );
}
