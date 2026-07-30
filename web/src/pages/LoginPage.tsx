import { useState } from "react";
import { useNavigate } from "../router";
import { api, setToken } from "../api/client";

export default function LoginPage() {
  const [token, setTok] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    setToken(token.trim());
    try {
      await api.verify();
      navigate("/", { replace: true });
    } catch {
      setError("Invalid token.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-ink-900 border border-ink-700 rounded-2xl p-8 shadow-xl"
      >
        <h1 className="text-2xl font-semibold text-white mb-1">Podium</h1>
        <p className="text-sm text-ink-400 mb-6">pi Agent web console</p>
        <label className="block text-sm mb-2 text-ink-300">Access token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setTok(e.target.value)}
          autoFocus
          className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-white outline-none focus:border-accent"
          placeholder="Enter your token"
        />
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="mt-5 w-full bg-accent-soft hover:bg-accent text-white rounded-lg py-2 font-medium disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
