import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown renders assistant text. Code highlighting is intentionally kept
// lightweight (styled <pre>/<code>) to avoid pulling shiki into the render
// path; the surrounding .prose-chat styles handle presentation.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
