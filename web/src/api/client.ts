// REST client for the Podium backend. The auth token is read from
// localStorage and sent as a Bearer header.
import type {
  FileEntry,
  MaskedKey,
  Model,
  SessionEntry,
  SessionState,
  SessionStats,
  SessionView,
} from "../types";

const TOKEN_KEY = "podium.token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// captureUrlToken picks up a `?token=` from the URL (e.g. the URL printed
// at server startup), stores it, and strips it from the address bar.
export function captureUrlToken(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return;
  setToken(token);
  params.delete("token");
  const search = params.toString();
  const url = window.location.pathname + (search ? `?${search}` : "") + window.location.hash;
  window.history.replaceState(null, "", url);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  verify: () => request<{ ok: boolean }>("/api/auth/verify", { method: "POST" }),

  listSessions: () => request<{ sessions: SessionView[] }>("/api/sessions"),

  createSession: (body: { name?: string; dir?: string }) =>
    request<SessionView>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),

  prepareSession: (
    id: string,
    body: { dir?: string; provider?: string; modelId?: string },
  ) =>
    request<SessionView>(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getSession: (id: string) =>
    request<{ session: SessionView; state?: SessionState; stats?: SessionStats }>(
      `/api/sessions/${id}`,
    ),

  deleteSession: (id: string, purge = false) =>
    request<{ ok: boolean }>(`/api/sessions/${id}?purge=${purge}`, { method: "DELETE" }),

  getEntries: (id: string, since?: string) =>
    request<{ entries: SessionEntry[]; leafId: string | null }>(
      `/api/sessions/${id}/entries${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    ),

  browseDirs: (path = "") =>
    request<{ root: string; path: string; abs: string; entries: FileEntry[] }>(
      `/api/dirs?path=${encodeURIComponent(path)}`,
    ),

  getModels: () => request<{ models: Model[] }>("/api/models"),

  getSessionModels: (id: string) =>
    request<{ models: Model[] }>(`/api/sessions/${id}/models`),

  getThinkingLevels: (id: string) =>
    request<{ levels: string[] }>(`/api/sessions/${id}/thinking-levels`),

  getKeys: () => request<{ keys: MaskedKey[] }>("/api/settings/keys"),

  putKey: (provider: string, key: string) =>
    request<{ keys: MaskedKey[] }>("/api/settings/keys", {
      method: "PUT",
      body: JSON.stringify({ provider, key }),
    }),
};
