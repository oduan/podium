import { useState } from "react";
import { PodiumIcon } from "../components/Icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { api, setToken } from "../api/client";
import { useNavigate } from "../router";

export default function LoginPage() {
  const [token, setTokenDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    setToken(token.trim());
    try {
      await api.verify();
      navigate("/", { replace: true });
    } catch {
      setError("访问令牌无效，请检查后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-theme"><ThemeToggle /></div>
      <form onSubmit={submit} className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark"><PodiumIcon /></span>
          <div className="auth-brand-copy">
            <h1>Podium</h1>
            <p>智能编码工作区</p>
          </div>
        </div>

        <div className="auth-form">
          <label htmlFor="access-token">访问令牌</label>
          <input
            id="access-token"
            type="password"
            value={token}
            onChange={(event) => setTokenDraft(event.target.value)}
            autoFocus
            autoComplete="current-password"
            className="form-control"
            placeholder="输入 Podium 访问令牌"
          />
          {error && <p className="form-error" style={{ marginTop: 9 }}>{error}</p>}
          <button type="submit" disabled={busy || !token.trim()} className="btn btn-primary">
            {busy ? "正在验证…" : "进入工作区"}
          </button>
        </div>
        <p className="auth-help">令牌仅用于连接你的 Podium 服务。</p>
      </form>
    </main>
  );
}
