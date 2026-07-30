import { useEffect, useState } from "react";
import type { ExtensionUiRequest } from "../../stores/sessionStore";
import { CloseIcon } from "../Icons";

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

  const replyValue = (value: string) => onAnswer({ type: "extension_ui_response", id: request.id, value });
  const replyConfirmed = (confirmed: boolean) => onAnswer({ type: "extension_ui_response", id: request.id, confirmed });
  const cancel = () => onAnswer({ type: "extension_ui_response", id: request.id, cancelled: true });

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-dialog-title"
      onMouseDown={(event) => event.target === event.currentTarget && cancel()}
      onKeyDown={(event) => event.key === "Escape" && cancel()}
    >
      <div className="dialog">
        <div className="dialog-header">
          <div>
            <h2 className="dialog-title" id="extension-dialog-title">{request.title || "需要你的输入"}</h2>
            {request.message && <p className="dialog-subtitle">{request.message}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={cancel} aria-label="取消">
            <CloseIcon />
          </button>
        </div>

        {request.method === "select" && (
          <div className="command-results">
            {(request.options ?? []).map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                onClick={() => replyValue(option)}
                className="command-item"
              >
                <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="command-copy"><span>{option}</span></span>
                <span />
              </button>
            ))}
          </div>
        )}

        {request.method === "confirm" && (
          <div className="dialog-footer">
            <button type="button" onClick={() => replyConfirmed(false)} className="btn">拒绝</button>
            <button type="button" onClick={() => replyConfirmed(true)} className="btn btn-primary">允许</button>
          </div>
        )}

        {(request.method === "input" || request.method === "editor") && (
          <>
            <div className="dialog-body">
              {request.method === "editor" ? (
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  autoFocus
                  rows={8}
                  placeholder={request.placeholder}
                  className="form-control"
                />
              ) : (
                <input
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && replyValue(text)}
                  autoFocus
                  placeholder={request.placeholder}
                  className="form-control"
                />
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" onClick={cancel} className="btn">取消</button>
              <button type="button" onClick={() => replyValue(text)} className="btn btn-primary">提交</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
