import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ArrowLeftIcon } from "../components/Icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { Link } from "../router";
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
      const result = await api.getKeys();
      setKeys(result.keys);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法加载密钥");
    }
  };

  const loadModels = async () => {
    setModelsError("");
    try {
      const result = await api.getModels();
      setModels(result.models);
    } catch (loadError) {
      setModels([]);
      setModelsError(loadError instanceof Error ? loadError.message : "无法加载模型");
    }
  };

  useEffect(() => {
    void loadKeys();
    void loadModels();
  }, []);

  const masked = (provider: string) => keys.find((key) => key.provider === provider)?.masked;

  const save = async (provider: string) => {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setSaving(provider);
    setError("");
    try {
      const result = await api.putKey(provider, key);
      setKeys(result.keys);
      setDrafts((previous) => ({ ...previous, [provider]: "" }));
      await loadModels();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving("");
    }
  };

  const remove = async (provider: string) => {
    const label = PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
    if (!window.confirm(`移除 ${label} 的 API 密钥？`)) return;
    setSaving(provider);
    setError("");
    try {
      const result = await api.putKey(provider, "");
      setKeys(result.keys);
      await loadModels();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "移除失败");
    } finally {
      setSaving("");
    }
  };

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link to="/" className="icon-btn" aria-label="返回工作区" title="返回工作区"><ArrowLeftIcon /></Link>
        <h1>设置与模型</h1>
        <ThemeToggle />
      </header>

      <div className="settings-scroll">
        <div className="settings-content">
          <section className="settings-section">
            <div className="settings-section-header">
              <h2>提供商 API 密钥</h2>
              <p>
                密钥保存在 Podium 服务端，并作为环境变量注入 pi 子进程。订阅登录（例如 Claude Pro）需在服务端运行一次 <code>pi</code> 完成配置，之后会自动继承凭据。
              </p>
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="provider-list">
              {PROVIDERS.map((provider) => {
                const configured = masked(provider.id);
                return (
                  <div key={provider.id} className="provider-row">
                    <div>
                      <div className="provider-name">{provider.label}</div>
                      <div className="provider-state">{configured ? `已配置 · ${configured}` : "尚未配置"}</div>
                    </div>
                    <input
                      type="password"
                      value={drafts[provider.id] ?? ""}
                      onChange={(event) => setDrafts((previous) => ({ ...previous, [provider.id]: event.target.value }))}
                      onKeyDown={(event) => event.key === "Enter" && void save(provider.id)}
                      placeholder={configured ? "输入新密钥以替换…" : "粘贴 API 密钥…"}
                      className="form-control"
                      aria-label={`${provider.label} API 密钥`}
                    />
                    <div className="provider-actions">
                      {configured && (
                        <button type="button" onClick={() => void remove(provider.id)} disabled={saving === provider.id} className="btn provider-remove">
                          移除
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void save(provider.id)}
                        disabled={saving === provider.id || !(drafts[provider.id] ?? "").trim()}
                        className="btn btn-primary"
                      >
                        {saving === provider.id ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-header">
              <h2>可用模型</h2>
              <p>模型列表会根据服务端当前可用的提供商凭据自动同步。</p>
            </div>
            {modelsError && <p className="form-error">{modelsError}</p>}
            <div className="model-list">
              {!modelsError && models.length === 0 && <p className="settings-empty">暂无可用模型，请先配置提供商密钥。</p>}
              {models.map((model) => (
                <div key={`${model.provider}:${model.id}`} className="model-row">
                  <div className="model-name">
                    {model.name}
                    {model.reasoning && <span className="model-badge">推理</span>}
                  </div>
                  <span className="model-provider">{model.provider}</span>
                  <span className="model-context">{model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k ctx` : "—"}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
