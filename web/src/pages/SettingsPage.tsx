import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ArrowLeftIcon } from "../components/Icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { Link } from "../router";
import type { Model } from "../types";

export default function SettingsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await api.getModels();
      setModels(result.models);
    } catch (loadError) {
      setModels([]);
      setModelsError(loadError instanceof Error ? loadError.message : "无法加载模型");
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    void loadModels();
  }, []);

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
              <h2>可用模型</h2>
              <p>模型由 pi Agent 配置和管理，此处仅展示当前可用的模型。</p>
            </div>
            {modelsError && <p className="form-error">{modelsError}</p>}
            <div className="model-list" aria-live="polite">
              {modelsLoading && <p className="settings-empty">正在从 pi Agent 获取可用模型…</p>}
              {!modelsLoading && !modelsError && models.length === 0 && (
                <p className="settings-empty">暂无可用模型，请通过 pi Agent 完成模型配置。</p>
              )}
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
