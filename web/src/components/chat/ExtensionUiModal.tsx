import { useEffect, useState } from "react";
import type { ExtensionUiRequest } from "../../stores/sessionStore";

// ExtensionUiModal renders the interactive request an extension raised through
// pi (select / confirm / input / editor) and returns the user's answer as an
// extension_ui_response passthrough command.
export function ExtensionUiModal({
  request,
  onAnswer,
}: {
  request: ExtensionUiRequest;
	onAnswer: (command: object) => boolean;
}) {
  const [text, setText] = useState(request.prefill ?? "");

	useEffect(() => {
	  setText(request.prefill ?? "");
	}, [request.id, request.prefill]);

	const replyValue = (value: string) =>
	  onAnswer({ type: "extension_ui_response", id: request.id, value });
	const replyConfirmed = (confirmed: boolean) =>
	  onAnswer({ type: "extension_ui_response", id: request.id, confirmed });
	const cancel = () =>
	  onAnswer({ type: "extension_ui_response", id: request.id, cancelled: true });

  return (
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
	  <div className="w-full max-w-lg bg-ink-900 border border-ink-700 rounded-2xl p-6 shadow-xl">
        {request.title && (
          <h2 className="text-lg font-semibold text-white mb-2">{request.title}</h2>
        )}
        {request.message && (
          <p className="text-sm text-ink-300 whitespace-pre-wrap mb-4">{request.message}</p>
        )}

        {request.method === "select" && (
          <div className="flex flex-col gap-2">
            {(request.options ?? []).map((opt, i) => (
              <button
                key={i}
				onClick={() => replyValue(opt)}
                className="text-left bg-ink-800 hover:bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-ink-200"
              >
                {opt}
              </button>
            ))}
			<button onClick={cancel} className="mt-2 px-3 py-2 text-sm text-ink-400 hover:text-white">
			  Cancel
			</button>
          </div>
        )}

        {request.method === "confirm" && (
          <div className="flex justify-end gap-3">
            <button
			  onClick={() => replyConfirmed(false)}
              className="px-4 py-2 text-sm text-ink-300 hover:text-white"
            >
              No
            </button>
            <button
			  onClick={() => replyConfirmed(true)}
              className="bg-accent-soft hover:bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              Yes
            </button>
          </div>
        )}

        {(request.method === "input" || request.method === "editor") && (
          <>
            {request.method === "editor" ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
				  if (e.key === "Escape") cancel();
				}}
                autoFocus
                rows={8}
                placeholder={request.placeholder}
                className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-white outline-none focus:border-accent font-mono text-sm"
              />
            ) : (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
				  if (e.key === "Enter") replyValue(text);
				  else if (e.key === "Escape") cancel();
				}}
                autoFocus
                placeholder={request.placeholder}
                className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-white outline-none focus:border-accent"
              />
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button
				onClick={cancel}
                className="px-4 py-2 text-sm text-ink-300 hover:text-white"
              >
                Cancel
              </button>
              <button
				onClick={() => replyValue(text)}
                className="bg-accent-soft hover:bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                Submit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
