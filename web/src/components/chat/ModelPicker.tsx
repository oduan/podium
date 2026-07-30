import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { CheckIcon, ChevronDownIcon } from "../Icons";
import type { Model, SessionState } from "../../types";

const FALLBACK_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function modelKey(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

function thinkingLabel(level: string): string {
  const labels: Record<string, string> = {
    default: "默认",
    off: "关闭",
    minimal: "极简",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最大",
  };
  return labels[level] ?? level;
}

interface PickerOption {
  value: string;
  label: string;
  meta?: string;
}

function InlinePicker({
  label,
  displayValue,
  selectedValue,
  options,
  disabled,
  align = "start",
  onChange,
}: {
  label: string;
  displayValue: string;
  selectedValue: string;
  options: PickerOption[];
  disabled?: boolean;
  align?: "start" | "end";
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`inline-selector${open ? " open" : ""}`}>
      <button
        type="button"
        className="inline-selector-trigger"
        disabled={disabled || options.length === 0}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{displayValue}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className={`inline-selector-menu align-${align}`} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className="inline-selector-option"
              role="option"
              aria-selected={option.value === selectedValue}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="inline-selector-check">{option.value === selectedValue && <CheckIcon />}</span>
              <span className="inline-selector-copy">
                <span>{option.label}</span>
                {option.meta && <small>{option.meta}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

  const modelOptions = useMemo(() => {
    const options: PickerOption[] = models.map((model) => ({
      value: modelKey(model.provider, model.id),
      label: model.name,
      meta: model.provider,
    }));
    if (currentModelKey && !options.some((option) => option.value === currentModelKey)) {
      options.unshift({
        value: currentModelKey,
        label: state?.model?.name ?? state?.model?.id ?? "当前模型",
        meta: state?.model?.provider,
      });
    }
    return options;
  }, [currentModelKey, models, state?.model]);

  const currentModelName = modelOptions.find((option) => option.value === currentModelKey)?.label
    ?? state?.model?.name
    ?? "选择模型";

  return (
    <div className="model-picker">
      <InlinePicker
        label="选择模型"
        displayValue={currentModelName}
        selectedValue={currentModelKey}
        options={modelOptions}
        disabled={disabled}
        onChange={(value) => {
          try {
            const [provider, id] = JSON.parse(value) as [string, string];
            if (provider && id) onModel(provider, id);
          } catch {
            // Ignore a stale option value.
          }
        }}
      />
      <span className="model-picker-separator" aria-hidden="true">·</span>
      <InlinePicker
        label="选择推理强度"
        displayValue={`推理 ${thinkingLabel(state?.thinkingLevel ?? "off")}`}
        selectedValue={state?.thinkingLevel ?? "off"}
        options={levels.map((level) => ({ value: level, label: thinkingLabel(level) }))}
        disabled={disabled}
        align="end"
        onChange={onThinking}
      />
    </div>
  );
}

export function DraftModelPicker({
  models,
  modelValue,
  thinkingLevel,
  disabled,
  onModel,
  onThinking,
}: {
  models: Model[];
  modelValue: string;
  thinkingLevel: string;
  disabled?: boolean;
  onModel: (value: string) => void;
  onThinking: (value: string) => void;
}) {
  const modelOptions = models.map((model) => ({
    value: modelKey(model.provider, model.id),
    label: model.name,
    meta: model.provider,
  }));
  const currentModelName = modelOptions.find((option) => option.value === modelValue)?.label
    ?? (disabled ? "正在加载模型…" : "默认模型");
  const levels = ["default", ...FALLBACK_THINKING_LEVELS];

  return (
    <div className="model-picker">
      <InlinePicker
        label="选择首条消息使用的模型"
        displayValue={currentModelName}
        selectedValue={modelValue}
        options={modelOptions}
        disabled={disabled}
        onChange={onModel}
      />
      <span className="model-picker-separator" aria-hidden="true">·</span>
      <InlinePicker
        label="选择首条消息使用的推理强度"
        displayValue={`推理 ${thinkingLabel(thinkingLevel)}`}
        selectedValue={thinkingLevel}
        options={levels.map((level) => ({ value: level, label: thinkingLabel(level) }))}
        align="end"
        onChange={onThinking}
      />
    </div>
  );
}
