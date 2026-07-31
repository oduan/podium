import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, PaperclipIcon, SendIcon, StopIcon } from "../Icons";

export interface PendingImage {
  // pi RPC expects exactly { type: "image", data, mimeType }.
  type: "image";
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE = 16 * 1024 * 1024;

// Composer owns the prompt draft and image attachments. Session/model controls
// are passed in so the full footer remains one responsive surface.
export function Composer({
  isStreaming,
  onSend,
  onAbort,
  setup,
  controls,
  disabled,
}: {
  isStreaming: boolean;
  onSend: (
    message: string,
    images: PendingImage[],
    behavior?: "steer",
  ) => boolean | Promise<boolean>;
  onAbort: () => boolean;
  setup?: ReactNode;
  controls?: ReactNode;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocusRef = useRef(false);
  const inputDisabled = disabled || submitting;
  const hasDraft = Boolean(text.trim()) || images.length > 0;
  const primaryAction = isStreaming && !hasDraft ? "abort" : "send";

  useEffect(() => {
    if (!restoreFocusRef.current || inputDisabled) return;
    window.requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      restoreFocusRef.current = false;
    });
  }, [inputDisabled]);

  const addFiles = async (files: FileList | null) => {
    if (!files || inputDisabled) return;
    setAttachmentError("");
    const next: PendingImage[] = [];
    let total = images.reduce((sum, image) => sum + image.size, 0);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (images.length + next.length >= MAX_IMAGES) {
        setAttachmentError(`最多可添加 ${MAX_IMAGES} 张图片。`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setAttachmentError(`${file.name} 超过 8 MiB。`);
        continue;
      }
      if (total + file.size > MAX_TOTAL_IMAGE_SIZE) {
        setAttachmentError("图片总大小超过 16 MiB。 ");
        break;
      }
      try {
        const data = await readAsBase64(file);
        next.push({ type: "image", data, mimeType: file.type, name: file.name, size: file.size });
        total += file.size;
      } catch {
        setAttachmentError(`无法读取 ${file.name}。`);
      }
    }
    if (next.length) setImages((previous) => [...previous, ...next]);
  };

  const submit = async () => {
    if (inputDisabled) return;
    const message = text.trim();
    if (!message && images.length === 0) return;
    setSubmitting(true);
    try {
      if (await onSend(message, images, isStreaming ? "steer" : undefined)) {
        restoreFocusRef.current = true;
        setText("");
        setImages([]);
        setAttachmentError("");
        if (textareaRef.current) textareaRef.current.style.height = "";
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <footer className="composer-shell">
      <div className="composer">
        {setup}

        <div className="composer-box">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {images.length > 0 && (
            <div className="attachments" aria-label="已添加的图片">
              {images.map((image, index) => (
                <div key={`${image.name}-${image.size}-${index}`} className="attachment-chip">
                  <PaperclipIcon />
                  <span>{image.name}</span>
                  <button
                    type="button"
                    onClick={() => setImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label={`移除 ${image.name}`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachmentError && <p className="attachment-error">{attachmentError}</p>}
          <textarea
            ref={textareaRef}
            value={text}
            disabled={inputDisabled}
            onChange={(event) => {
              setText(event.target.value);
              event.currentTarget.style.height = "auto";
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 144)}px`;
            }}
            maxLength={256 * 1024}
            onKeyDown={onKeyDown}
            onPaste={(event) => void addFiles(event.clipboardData.files)}
            rows={1}
            placeholder={isStreaming ? "补充指令或安排下一步…" : "向 Agent 发送消息…"}
            aria-label="消息"
          />
          <div className="composer-toolbar">
            <div className="composer-toolbar-left">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={inputDisabled}
                className="icon-btn composer-attach"
                title="添加图片"
                aria-label="添加图片"
              >
                <PaperclipIcon />
              </button>
              {controls}
            </div>
            <div className="composer-toolbar-actions">
              <button
                type="button"
                onClick={() => {
                  if (primaryAction === "abort") {
                    onAbort();
                  } else {
                    void submit();
                  }
                }}
                disabled={inputDisabled || (primaryAction === "send" && !hasDraft)}
                className={`btn composer-primary-btn${primaryAction === "abort" ? " terminate-btn" : " btn-primary"}`}
                title={primaryAction === "abort" ? "终止当前运行" : "发送消息"}
                aria-label={primaryAction === "abort" ? "终止当前运行" : "发送消息"}
              >
                {primaryAction === "abort"
                  ? <StopIcon />
                  : submitting
                    ? <span className="tool-spinner" />
                    : <SendIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
