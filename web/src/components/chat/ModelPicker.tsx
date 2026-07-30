import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Model, SessionState } from "../../types";

const FALLBACK_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function modelKey(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

export function ModelPicker({
  sessionId,
  state,
  disabled,
  onModel,
  onThinking,
}: {
  sessionId: string;
  state: SessionState | null;
  disabled?: boolean;
  onModel: (provider: string, modelId: string) => void;
  onThinking: (level: string) => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(FALLBACK_THINKING_LEVELS);
  const currentModelKey = state?.model ? modelKey(state.model.provider, state.model.id) : "";

  useEffect(() => {
    let active = true;
    api
      .getSessionModels(sessionId)
      .then((result) => {
        if (active) setModels(Array.isArray(result.models) ? result.models : []);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    api
      .getThinkingLevels(sessionId)
      .then((result) => {
        if (active && Array.isArray(result.levels) && result.levels.length > 0) {
          setThinkingLevels(result.levels);
        }
      })
      .catch(() => {
        if (active) setThinkingLevels(FALLBACK_THINKING_LEVELS);
      });
    return () => {
      active = false;
    };
  }, [sessionId, currentModelKey]);

  const levels = useMemo(() => {
    const current = state?.thinkingLevel;
    return current && !thinkingLevels.includes(current) ? [current, ...thinkingLevels] : thinkingLevels;
  }, [state?.thinkingLevel, thinkingLevels]);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs font-medium text-ink-500">Model</span>
      <select
        value={currentModelKey}
        disabled={disabled}
        onChange={(event) => {
          try {
            const [provider, id] = JSON.parse(event.target.value) as [string, string];
            if (provider && id) onModel(provider, id);
          } catch {
            // Ignore a stale option value.
          }
        }}
        className="max-w-[16rem] rounded-md border border-white/[0.08] bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 outline-none transition focus:border-accent disabled:opacity-50"
        title="Model"
      >
        {currentModelKey && !models.some((model) => modelKey(model.provider, model.id) === currentModelKey) && (
          <option value={currentModelKey}>{state?.model?.name ?? state?.model?.id}</option>
        )}
        {models.length === 0 && !currentModelKey && <option value="">No models</option>}
        {models.map((model) => (
          <option key={modelKey(model.provider, model.id)} value={modelKey(model.provider, model.id)}>
            {model.name} · {model.provider}
          </option>
        ))}
      </select>
      <span className="ml-1 text-xs font-medium text-ink-500">Thinking</span>
      <select
        value={state?.thinkingLevel ?? "off"}
        disabled={disabled}
        onChange={(event) => onThinking(event.target.value)}
        className="rounded-md border border-white/[0.08] bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 outline-none transition focus:border-accent disabled:opacity-50"
        title="Thinking level"
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </div>
  );
}
