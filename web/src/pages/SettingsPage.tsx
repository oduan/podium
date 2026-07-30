import { useEffect, useState } from "react";
import { Link } from "../router";
import { api } from "../api/client";
import type { MaskedKey, Model } from "../types";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "groq", label: "Groq" },
  { id: "cerebras", label: "Cerebras" },
  { id: "xai", label: "xAI (Grok)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "mistral", label: "Mistral" },
  { id: "zai", label: "Z.ai" },
  { id: "deepseek", label: "DeepSeek" },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<MaskedKey[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [modelsError, setModelsError] = useState("");

  const loadKeys = async () => {
    try {
      const res = await api.getKeys();
      setKeys(res.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load keys");
    }
  };

	const loadModels = async () => {
	  setModelsError("");
	  try {
		const res = await api.getModels();
		setModels(res.models);
	  } catch (e) {
		setModels([]);
		setModelsError(e instanceof Error ? e.message : "Failed to load models");
	  }
	};

  useEffect(() => {
    void loadKeys();
	void loadModels();
  }, []);

  const masked = (provider: string) => keys.find((k) => k.provider === provider)?.masked;

  const save = async (provider: string) => {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setSaving(provider);
    setError("");
    try {
      const res = await api.putKey(provider, key);
      setKeys(res.keys);
      setDrafts((d) => ({ ...d, [provider]: "" }));
	  await loadModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving("");
    }
  };

  const remove = async (provider: string) => {
    setSaving(provider);
	setError("");
    try {
      const res = await api.putKey(provider, "");
      setKeys(res.keys);
	  await loadModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-ink-800">
        <Link to="/" className="text-sm text-ink-300 hover:text-white">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-lg font-medium text-white mb-1">Provider API keys</h2>
          <p className="text-sm text-ink-400 mb-4">
            Keys are stored on the server and injected as environment variables into pi
            subprocesses. Subscription logins (e.g. Claude Pro) are configured by running{" "}
            <code className="bg-ink-800 px-1 rounded">pi</code> once on the server; those
            credentials are inherited automatically.
          </p>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <div className="flex flex-col gap-3">
            {PROVIDERS.map((p) => {
              const m = masked(p.id);
              return (
                <div
                  key={p.id}
                  className="bg-ink-900 border border-ink-700 rounded-lg p-3 flex items-center gap-3"
                >
                  <div className="w-40 shrink-0">
                    <div className="text-sm text-ink-200">{p.label}</div>
                    <div className="text-xs text-ink-500">
                      {m ? `configured · ${m}` : "not configured"}
                    </div>
                  </div>
                  <input
                    type="password"
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    placeholder={m ? "Replace key…" : "Paste API key…"}
                    className="flex-1 bg-ink-800 border border-ink-600 rounded px-3 py-1.5 text-white text-sm outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => save(p.id)}
                    disabled={saving === p.id || !(drafts[p.id] ?? "").trim()}
                    className="bg-accent-soft hover:bg-accent text-white rounded px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    Save
                  </button>
                  {m && (
                    <button
                      onClick={() => remove(p.id)}
                      disabled={saving === p.id}
                      className="text-ink-500 hover:text-red-400 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium text-white mb-3">Available models</h2>
          {modelsError && <p className="text-ink-500 text-sm">{modelsError}</p>}
          {!modelsError && models.length === 0 && (
            <p className="text-ink-500 text-sm">No models reported. Configure a key above.</p>
          )}
          <div className="flex flex-col gap-1">
            {models.map((m) => (
              <div
                key={`${m.provider}:${m.id}`}
                className="flex items-center gap-3 text-sm py-1 border-b border-ink-800/50"
              >
                <span className="text-ink-200">{m.name}</span>
                <span className="text-xs text-ink-500">{m.provider}</span>
                {m.reasoning && <span className="text-xs text-accent">reasoning</span>}
                {m.contextWindow && (
                  <span className="text-xs text-ink-500 ml-auto">
                    {Math.round(m.contextWindow / 1000)}k ctx
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
