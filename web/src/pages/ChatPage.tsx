import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearToken } from "../api/client";
import { Link, useNavigate, useParams } from "../router";
import { useSessionStore } from "../stores/sessionStore";
import type { Model, SessionView } from "../types";
import { DirPicker } from "../components/DirPicker";
import { Toasts } from "../components/Toasts";
import { Composer, type PendingImage } from "../components/chat/Composer";
import { ExtensionUiModal } from "../components/chat/ExtensionUiModal";
import { MessageStream } from "../components/chat/MessageStream";
import { ModelPicker } from "../components/chat/ModelPicker";
import { StatsBar } from "../components/chat/StatsBar";

function modelKey(model: Pick<Model, "provider" | "id">): string {
  return JSON.stringify([model.provider, model.id]);
}

function parseModelKey(value: string): Pick<Model, "provider" | "id"> | null {
  try {
    const [provider, id] = JSON.parse(value) as [string, string];
    return provider && id ? { provider, id } : null;
  } catch {
    return null;
  }
}

function statusColor(status: string): string {
  if (status === "running") return "text-emerald-400";
  if (status === "stopped" || status === "error") return "text-red-400";
  return "text-ink-500";
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 7.25A2.75 2.75 0 1 0 10 12.75 2.75 2.75 0 0 0 10 7.25Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="m15.6 11.2 1.1.86-1.5 2.6-1.3-.52a6.2 6.2 0 0 1-1.7.98L12 16.5H9l-.2-1.38a6.2 6.2 0 0 1-1.7-.98l-1.3.52-1.5-2.6 1.1-.86a6.5 6.5 0 0 1 0-2.4l-1.1-.86 1.5-2.6 1.3.52a6.2 6.2 0 0 1 1.7-.98L9 3.5h3l.2 1.38a6.2 6.2 0 0 1 1.7.98l1.3-.52 1.5 2.6-1.1.86a6.5 6.5 0 0 1 0 2.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path d="M2.75 6.25h5l1.5 1.5h8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.75 7.75v-2a1.5 1.5 0 0 1 1.5-1.5H7l1.5 2h7.25a1.5 1.5 0 0 1 1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const open = useSessionStore((store) => store.open);
  const close = useSessionStore((store) => store.close);
  const items = useSessionStore((store) => store.items);
  const isStreaming = useSessionStore((store) => store.isStreaming);
  const wsStatus = useSessionStore((store) => store.wsStatus);
  const processStatus = useSessionStore((store) => store.processStatus);
  const state = useSessionStore((store) => store.state);
  const stats = useSessionStore((store) => store.stats);
  const compacting = useSessionStore((store) => store.compacting);
  const uiRequest = useSessionStore((store) => store.uiRequest);
  const sendPrompt = useSessionStore((store) => store.sendPrompt);
  const abort = useSessionStore((store) => store.abort);
  const setModel = useSessionStore((store) => store.setModel);
  const setThinkingLevel = useSessionStore((store) => store.setThinkingLevel);
  const setSessionName = useSessionStore((store) => store.setSessionName);
  const answerUi = useSessionStore((store) => store.answerUi);

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [selectedDir, setSelectedDir] = useState("");
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [draftModels, setDraftModels] = useState<Model[]>([]);
  const [draftModelKey, setDraftModelKey] = useState("");
  const [draftModelLoading, setDraftModelLoading] = useState(false);
  const [draftModelError, setDraftModelError] = useState("");
  const [firstPromptError, setFirstPromptError] = useState("");
  const pendingFirstPrompt = useRef<{
    sessionId: string;
    message: string;
    images: PendingImage[];
  } | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const result = await api.listSessions();
      setSessions(result.sessions);
      setSessionsError("");
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Failed to load sessions");
    } finally {
      setSessionsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (sessionsLoaded && !id && sessions.length > 0) {
      navigate(`/sessions/${sessions[0].id}`, { replace: true });
    }
  }, [id, navigate, sessions, sessionsLoaded]);

  const current = sessions.find((session) => session.id === id);
  const currentPending = current?.pending;

  useEffect(() => {
    if (!id || !sessionsLoaded || !current || currentPending) {
      close();
      return;
    }
    void open(id);
    return () => close();
  }, [close, current, currentPending, id, open, sessionsLoaded]);

  useEffect(() => {
    setSelectedDir("");
    setDirPickerOpen(false);
    setDraftModels([]);
    setDraftModelKey("");
    setDraftModelError("");
    setFirstPromptError("");
    if (!currentPending) return;

    let active = true;
    setDraftModelLoading(true);
    api
      .getModels()
      .then((result) => {
        if (!active) return;
        const models = Array.isArray(result.models) ? result.models : [];
        setDraftModels(models);
        setDraftModelKey(models[0] ? modelKey(models[0]) : "");
      })
      .catch((error) => {
        if (!active) return;
        setDraftModelError(error instanceof Error ? error.message : "Models unavailable");
      })
      .finally(() => {
        if (active) setDraftModelLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentPending, id]);

  useEffect(() => {
    const queued = pendingFirstPrompt.current;
    if (!queued || queued.sessionId !== id || wsStatus !== "open") return;
    pendingFirstPrompt.current = null;
    if (!sendPrompt(queued.message, queued.images)) {
      setFirstPromptError("The session started, but the first message could not be sent.");
    }
  }, [id, sendPrompt, wsStatus]);

  const createSession = async () => {
    if (creating) return;
    setCreating(true);
    setSessionsError("");
    try {
      const created = await api.createSession({});
      setSessions((previous) => [created, ...previous.filter((session) => session.id !== created.id)]);
      navigate(`/sessions/${created.id}`);
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async (session: SessionView) => {
    if (deleting || !confirm("Delete this session? The pi session files stay on disk.")) return;
    setDeleting(session.id);
    try {
      await api.deleteSession(session.id);
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (session.id === id) {
        navigate(remaining[0] ? `/sessions/${remaining[0].id}` : "/", { replace: true });
      }
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Failed to delete session");
    } finally {
      setDeleting("");
    }
  };

  const logout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const name = state?.sessionName || current?.name || "New session";
  const commitName = () => {
    const next = nameDraft.trim();
    if (!next || next === name) {
      setEditingName(false);
      return;
    }
    if (setSessionName(next)) setEditingName(false);
  };

  const handleSend = async (
    message: string,
    images: PendingImage[],
    behavior?: "steer" | "followUp",
  ): Promise<boolean> => {
    if (!current?.pending) return sendPrompt(message, images, behavior);

    setFirstPromptError("");
    const selectedModel = parseModelKey(draftModelKey);
    try {
      const prepared = await api.prepareSession(current.id, {
        dir: selectedDir || undefined,
        provider: selectedModel?.provider,
        modelId: selectedModel?.id,
      });
      pendingFirstPrompt.current = { sessionId: current.id, message, images };
      setSessions((previous) =>
        previous.map((session) => (session.id === prepared.id ? prepared : session)),
      );
      return true;
    } catch (error) {
      setFirstPromptError(error instanceof Error ? error.message : "Failed to start session");
      return false;
    }
  };

  return (
    <div className="h-full min-w-[760px] overflow-hidden bg-ink-950 text-ink-300 flex">
      <aside className="w-64 shrink-0 border-r border-white/[0.06] bg-ink-900 flex flex-col">
        <div className="h-16 px-4 flex items-center border-b border-white/[0.06]">
          <div className="h-7 w-7 rounded-lg bg-accent-soft/15 text-accent flex items-center justify-center mr-2.5">
            <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_rgba(110,168,254,0.65)]" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-white">Podium</span>
        </div>

        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <span className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">Sessions</span>
          <button
            type="button"
            onClick={() => void createSession()}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-xs font-medium text-ink-200 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-40"
          >
            <PlusIcon />
            {creating ? "Creating" : "New"}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {!sessionsLoaded && <p className="px-2 py-3 text-xs text-ink-500">Loading sessions…</p>}
          {sessionsError && <p className="px-2 py-3 text-xs leading-relaxed text-red-400">{sessionsError}</p>}
          {sessionsLoaded && sessions.length === 0 && !sessionsError && (
            <p className="px-2 py-3 text-xs leading-relaxed text-ink-500">No sessions yet.</p>
          )}
          <div className="space-y-0.5">
            {sessions.map((session) => {
              const active = session.id === id;
              const sessionName = active ? state?.sessionName || session.name : session.name;
              const subtitle = session.pending
                ? active && selectedDir
                  ? selectedDir
                  : "Default workspace on first message"
                : session.cwd;
              return (
                <div key={session.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => navigate(`/sessions/${session.id}`)}
                    className={`w-full rounded-lg px-3 py-2.5 pr-8 text-left transition duration-150 ${
                      active
                        ? "bg-white/[0.075] shadow-[inset_2px_0_0_#6ea8fe]"
                        : "hover:bg-white/[0.045]"
                    }`}
                  >
                    <span className={`block truncate text-sm ${active ? "text-white" : "text-ink-300"}`}>
                      {sessionName || "New session"}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-500">{subtitle}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSession(session)}
                    disabled={deleting === session.id}
                    title="Delete session"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-white/[0.06] p-2">
          <Link
            to="/settings"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-400 transition hover:bg-white/[0.045] hover:text-white"
          >
            <SettingsIcon />
            Settings
          </Link>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-500 transition hover:bg-white/[0.045] hover:text-ink-200"
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      </aside>

      {!id || !current ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 animate-fade-in items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-ink-500">Select a session or start a new one.</p>
              <button
                type="button"
                onClick={() => void createSession()}
                disabled={creating}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent disabled:opacity-40"
              >
                <PlusIcon />
                New session
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col animate-fade-in">
          <header className="h-16 shrink-0 border-b border-white/[0.06] px-5 flex items-center gap-3">
            {editingName ? (
              <input
                value={nameDraft}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => event.key === "Enter" && commitName()}
                className="min-w-0 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent"
              />
            ) : (
              <button
                type="button"
                disabled={current.pending || wsStatus !== "open"}
                onClick={() => {
                  setNameDraft(name);
                  setEditingName(true);
                }}
                className="truncate text-sm font-medium text-white transition hover:text-accent disabled:hover:text-white"
                title={current.pending ? "The session will be named after it starts" : "Rename session"}
              >
                {name}
              </button>
            )}
            {current.pending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-600" />
                Not started
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-xs ${statusColor(processStatus)}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {processStatus}
                {wsStatus !== "open" ? ` · ${wsStatus}` : ""}
              </span>
            )}
          </header>

          <MessageStream items={items} />
          <StatsBar state={state} stats={stats} compacting={compacting} />

          <div className="shrink-0 border-t border-white/[0.06] bg-ink-950/95 backdrop-blur">
            <div className="mx-auto max-w-3xl px-5 pt-3">
              {current.pending ? (
                <div className="space-y-2 animate-slide-up">
                  <div className="flex items-center gap-3">
                    <label className="w-16 shrink-0 text-xs font-medium text-ink-500">Model</label>
                    <select
                      value={draftModelKey}
                      disabled={draftModelLoading}
                      onChange={(event) => setDraftModelKey(event.target.value)}
                      title={draftModelError || "Model used for the first message"}
                      className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-ink-900 px-2.5 py-1.5 text-xs text-ink-200 outline-none transition focus:border-accent disabled:opacity-60"
                    >
                      {draftModels.length === 0 && (
                        <option value="">{draftModelLoading ? "Loading models…" : "pi default model"}</option>
                      )}
                      {draftModels.map((model) => (
                        <option key={modelKey(model)} value={modelKey(model)}>
                          {model.name} · {model.provider}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs font-medium text-ink-500">Folder</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-ink-400">
                        <FolderIcon />
                        <span className="truncate font-mono">
                          {selectedDir || "Default workspace when the first message is sent"}
                        </span>
                      </span>
                      {selectedDir && (
                        <button
                          type="button"
                          onClick={() => setSelectedDir("")}
                          className="text-ink-500 transition hover:text-white"
                        >
                          Use default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDirPickerOpen((openPicker) => !openPicker)}
                        className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-ink-200 transition hover:bg-white/[0.1] hover:text-white"
                      >
                        {dirPickerOpen ? "Close" : "Choose"}
                      </button>
                    </div>
                  </div>

                  {dirPickerOpen && (
                    <DirPicker
                      onSelect={(directory) => {
                        setSelectedDir(directory);
                        setDirPickerOpen(false);
                      }}
                      onCancel={() => setDirPickerOpen(false)}
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-4 animate-slide-up">
                  <ModelPicker
                    sessionId={id}
                    state={state}
                    disabled={wsStatus !== "open"}
                    onModel={setModel}
                    onThinking={setThinkingLevel}
                  />
                  <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-ink-500" title={current.cwd}>
                    <FolderIcon />
                    <span className="max-w-64 truncate font-mono">{current.cwd}</span>
                  </div>
                </div>
              )}
              {firstPromptError && <p className="mt-2 text-xs text-red-400">{firstPromptError}</p>}
            </div>

            <Composer
              isStreaming={current.pending ? false : isStreaming}
              onAbort={abort}
              onSend={handleSend}
              disabled={!current.pending && wsStatus !== "open"}
            />
          </div>
        </main>
      )}

      {uiRequest && <ExtensionUiModal request={uiRequest} onAnswer={answerUi} />}
      <Toasts />
    </div>
  );
}
