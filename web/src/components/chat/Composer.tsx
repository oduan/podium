import { useRef, useState } from "react";

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

// Composer is the message input. While the agent is streaming it exposes a
// steer/follow-up selector and an abort button; otherwise it sends a normal
// prompt. Pasted or attached images are carried as base64.
export function Composer({
  isStreaming,
  onSend,
  onAbort,
  disabled,
}: {
  isStreaming: boolean;
	onSend: (
	  message: string,
	  images: PendingImage[],
	  behavior?: "steer" | "followUp",
	) => boolean | Promise<boolean>;
	onAbort: () => boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [behavior, setBehavior] = useState<"steer" | "followUp">("steer");
  const [images, setImages] = useState<PendingImage[]>([]);
	const [attachmentError, setAttachmentError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputDisabled = disabled || submitting;

  const addFiles = async (files: FileList | null) => {
	if (!files || inputDisabled) return;
	setAttachmentError("");
    const next: PendingImage[] = [];
	let total = images.reduce((sum, image) => sum + image.size, 0);
	for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
	  if (images.length + next.length >= MAX_IMAGES) {
		setAttachmentError(`You can attach at most ${MAX_IMAGES} images.`);
		break;
	  }
	  if (file.size > MAX_IMAGE_SIZE) {
		setAttachmentError(`${file.name} is larger than 8 MiB.`);
		continue;
	  }
	  if (total + file.size > MAX_TOTAL_IMAGE_SIZE) {
		setAttachmentError("Attached images exceed the 16 MiB total limit.");
		break;
	  }
	  try {
		const data = await readAsBase64(file);
		next.push({ type: "image", data, mimeType: file.type, name: file.name, size: file.size });
		total += file.size;
	  } catch {
		setAttachmentError(`Could not read ${file.name}.`);
	  }
    }
    if (next.length) setImages((prev) => [...prev, ...next]);
  };

  const submit = async () => {
	if (inputDisabled) return;
    const msg = text.trim();
    if (!msg && images.length === 0) return;
	setSubmitting(true);
	try {
	  if (await onSend(msg, images, isStreaming ? behavior : undefined)) {
	    setText("");
	    setImages([]);
	    setAttachmentError("");
	  }
	} finally {
	  setSubmitting(false);
	}
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="px-5 pb-5 pt-3">
      <div className="max-w-3xl mx-auto">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((img, i) => (
              <div
                key={i}
                className="flex items-center gap-1 bg-ink-800 border border-ink-700 rounded px-2 py-1 text-xs text-ink-300"
              >
                🖼 {img.name}
                <button
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  className="text-ink-500 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
		{attachmentError && <p className="text-xs text-red-400 mb-2">{attachmentError}</p>}
        <div className="flex items-end gap-2">
          {isStreaming && (
            <select
              value={behavior}
              disabled={inputDisabled}
              onChange={(e) => setBehavior(e.target.value as "steer" | "followUp")}
              className="bg-ink-800 border border-ink-600 rounded-lg text-xs text-ink-300 px-2 py-2 outline-none"
              title="How to deliver this message while the agent is working"
            >
              <option value="steer">steer</option>
              <option value="followUp">follow-up</option>
            </select>
          )}
          <textarea
            value={text}
			disabled={inputDisabled}
            onChange={(e) => setText(e.target.value)}
			maxLength={256 * 1024}
            onKeyDown={onKeyDown}
            onPaste={(e) => addFiles(e.clipboardData.files)}
            rows={1}
            placeholder={isStreaming ? "Steer or queue a follow-up…" : "Message the agent…"}
            className="flex-1 resize-none bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-white outline-none focus:border-accent max-h-40"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
			onChange={(e) => {
			  void addFiles(e.target.files);
			  e.target.value = "";
			}}
          />
          <button
            onClick={() => fileRef.current?.click()}
			disabled={inputDisabled}
			className="px-2 py-2 text-ink-400 hover:text-white disabled:opacity-40"
            title="Attach image"
          >
            📎
          </button>
          {isStreaming && (
            <button
              onClick={onAbort}
			  disabled={inputDisabled}
			  className="bg-red-600/80 hover:bg-red-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40"
            >
              Stop
            </button>
          )}
          <button
            onClick={() => void submit()}
            disabled={inputDisabled || (!text.trim() && images.length === 0)}
            className="bg-accent-soft hover:bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {submitting ? "Starting…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      // Strip the data URL prefix, keep raw base64.
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
