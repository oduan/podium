import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, clearToken } from "../api/client";
import { DirPicker } from "../components/DirPicker";
import { RecentDirectorySelect } from "../components/RecentDirectorySelect";
import {
  CloseIcon,
  FolderIcon,
  InfoIcon,
  MenuIcon,
  PlusIcon,
  PodiumIcon,
  SettingsIcon,
  SignOutIcon,
} from "../components/Icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { Toasts } from "../components/Toasts";
import { Composer, type PendingImage } from "../components/chat/Composer";
import { ExtensionUiModal } from "../components/chat/ExtensionUiModal";
import { MessageStream } from "../components/chat/MessageStream";
import { DraftModelPicker, ModelPicker } from "../components/chat/ModelPicker";
import { Link, useNavigate, useParams } from "../router";
import { useSessionStore } from "../stores/sessionStore";
import type { Model, SessionState, SessionStats, SessionView } from "../types";

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

function thinkingLabel(level?: string): string {
  const labels: Record<string, string> = {
    off: "关闭",
    minimal: "极简",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最大",
  };
  return level ? labels[level] ?? level : "—";
}

function isToday(date: string): boolean {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return false;
  const now = new Date();
  return value.getFullYear() === now.getFullYear()
    && value.getMonth() === now.getMonth()
    && value.getDate() === now.getDate();
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("\\") || path;
}

function statusPresentation({
  pending,
  processStatus,
  wsStatus,
  isStreaming,
}: {
  pending: boolean;
  processStatus: string;
  wsStatus: string;
  isStreaming: boolean;
}): { label: string; dot: string } {
  if (pending) return { label: "尚未启动", dot: "" };
  if (wsStatus === "connecting") return { label: "正在连接", dot: "connecting" };
  if (wsStatus !== "open") return { label: "连接已断开", dot: "error" };
  if (processStatus === "error" || processStatus === "stopped") {
    return { label: processStatus === "error" ? "运行异常" : "已停止", dot: "error" };
  }
  if (isStreaming) return { label: "Agent 正在处理", dot: "live" };
  if (processStatus === "running") return { label: "正在运行", dot: "live" };
  return { label: "已连接", dot: "live" };
}

function RuntimeStatus({
  current,
  state,
  stats,
  processStatus,
  wsStatus,
  isStreaming,
  compacting,
  queue,
  pendingDirectory,
  onCompact,
  onAbort,
}: {
  current?: SessionView;
  state: SessionState | null;
  stats: SessionStats | null;
  processStatus: string;
  wsStatus: string;
  isStreaming: boolean;
  compacting: boolean;
  queue: { steering: string[]; followUp: string[] };
  pendingDirectory: string;
  onCompact: () => boolean;
  onAbort: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const status = statusPresentation({
    pending: Boolean(current?.pending),
    processStatus,
    wsStatus,
    isStreaming,
  });
  const queued = [
    ...queue.steering.map((text) => ({ text, kind: "当前任务调整" })),
    ...queue.followUp.map((text) => ({ text, kind: "下一轮" })),
  ];
  const contextPercent = stats?.contextUsage?.percent;
  const contextTokens = stats?.contextUsage?.tokens ?? stats?.tokens?.total;
  const contextText = contextPercent != null
    ? `${Math.round(contextPercent)}%${contextTokens != null ? ` · ${contextTokens.toLocaleString()} tokens` : ""}`
    : contextTokens != null
      ? `${contextTokens.toLocaleString()} tokens`
      : "等待同步";
  const directory = current?.pending ? pendingDirectory || "默认工作区" : current?.cwd || "—";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
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
    <div className="runtime-status">
      <span className="connection"><span className={`status-dot ${status.dot}`} />{status.label}</span>
      <div
        ref={anchorRef}
        className={`runtime-info-anchor${open ? " open" : ""}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!anchorRef.current?.contains(document.activeElement)) setOpen(false);
        }}
        onFocusCapture={() => setOpen(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <button
          type="button"
          className="info-trigger"
          aria-label="查看会话信息"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <InfoIcon />
        </button>
        {open && (
          <div className="runtime-popover" role="dialog" aria-label="会话信息">
            <div className="runtime-popover-header">
              <span>会话信息</span>
              <span className="runtime-popover-state"><span className={`status-dot ${status.dot}`} />{status.label}</span>
            </div>
            <dl className="runtime-details">
              <div><dt>模型</dt><dd>{state?.model?.name || (current?.pending ? "首条消息时选择" : "pi 默认模型")}</dd></div>
              <div><dt>推理</dt><dd>{thinkingLabel(state?.thinkingLevel)}</dd></div>
              <div><dt>工作目录</dt><dd className="mono" title={directory}>{directory}</dd></div>
              <div><dt>上下文</dt><dd>{contextText}</dd></div>
              {stats?.cost != null && <div><dt>费用</dt><dd>${stats.cost.toFixed(4)}</dd></div>}
              {state?.messageCount != null && <div><dt>消息</dt><dd>{state.messageCount.toLocaleString()}</dd></div>}
            </dl>

            <section className="runtime-popover-section">
              <div className="runtime-section-title"><span>当前队列</span><span>{queued.length}</span></div>
              {queued.length === 0 ? (
                <p className="queue-empty">没有等待中的消息。</p>
              ) : (
                <ol className="queue-list">
                  {queued.map((item, index) => (
                    <li className="queue-item" key={`${item.kind}-${index}`}>
                      <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                      <span>{item.text}<small className="queue-kind">{item.kind}</small></span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <div className="runtime-popover-actions">
              <button
                type="button"
                className="btn"
              onClick={onCompact}
              disabled={!current || current.pending || wsStatus !== "open" || compacting || isStreaming}
            >
              {compacting ? "正在整理…" : "整理上下文"}
            </button>
              <button type="button" className="btn btn-danger" onClick={onAbort} disabled={!isStreaming || wsStatus !== "open"}>
                停止当前运行
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
  const queue = useSessionStore((store) => store.queue);
  const state = useSessionStore((store) => store.state);
  const stats = useSessionStore((store) => store.stats);
  const compacting = useSessionStore((store) => store.compacting);
  const uiRequest = useSessionStore((store) => store.uiRequest);
  const sendPrompt = useSessionStore((store) => store.sendPrompt);
  const abort = useSessionStore((store) => store.abort);
  const compact = useSessionStore((store) => store.compact);
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
  const [draftThinkingLevel, setDraftThinkingLevel] = useState("default");
  const [draftModelLoading, setDraftModelLoading] = useState(false);
  const [draftModelError, setDraftModelError] = useState("");
  const [firstPromptError, setFirstPromptError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionDir, setNewSessionDir] = useState("");
  const [newSessionModelKey, setNewSessionModelKey] = useState("");
  const [newSessionModels, setNewSessionModels] = useState<Model[]>([]);
  const [newSessionModelsLoading, setNewSessionModelsLoading] = useState(false);
  const [newSessionDirPicker, setNewSessionDirPicker] = useState(false);
  const [newSessionError, setNewSessionError] = useState("");

  const pendingFirstPrompt = useRef<{
    sessionId: string;
    message: string;
    images: PendingImage[];
    thinkingLevel?: string;
  } | null>(null);
  const pendingDefaults = useRef<{ sessionId: string; dir: string; modelKey: string } | null>(null);
  const commandSearchRef = useRef<HTMLInputElement>(null);
  const newSessionNameRef = useRef<HTMLInputElement>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const result = await api.listSessions();
      setSessions(result.sessions);
      setSessionsError("");
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "无法加载会话");
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
  const currentExists = Boolean(current);

  useEffect(() => {
    if (!id || !sessionsLoaded || !currentExists || currentPending) {
      close();
      return;
    }
    void open(id);
    return () => close();
  }, [close, currentExists, currentPending, id, open, sessionsLoaded]);

  useEffect(() => {
    setEditingName(false);
    setDirPickerOpen(false);
    setDraftModels([]);
    setDraftModelKey("");
    setDraftThinkingLevel("default");
    setDraftModelError("");
    setFirstPromptError("");
    const defaults = pendingDefaults.current?.sessionId === id ? pendingDefaults.current : null;
    setSelectedDir(defaults?.dir ?? "");
    if (!currentPending) return;

    let active = true;
    setDraftModelLoading(true);
    api
      .getModels()
      .then((result) => {
        if (!active) return;
        const models = Array.isArray(result.models) ? result.models : [];
        setDraftModels(models);
        const preferred = defaults?.modelKey;
        setDraftModelKey(preferred && models.some((model) => modelKey(model) === preferred)
          ? preferred
          : models[0]
            ? modelKey(models[0])
            : "");
        if (defaults) pendingDefaults.current = null;
      })
      .catch((error) => {
        if (!active) return;
        setDraftModelError(error instanceof Error ? error.message : "无法加载模型");
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
    if (queued.thinkingLevel) setThinkingLevel(queued.thinkingLevel);
    if (!sendPrompt(queued.message, queued.images)) {
      setFirstPromptError("会话已启动，但首条消息发送失败，请重试。");
    }
  }, [id, sendPrompt, setThinkingLevel, wsStatus]);

  useEffect(() => {
    if (commandOpen) window.setTimeout(() => commandSearchRef.current?.focus(), 20);
  }, [commandOpen]);

  useEffect(() => {
    if (newSessionOpen) window.setTimeout(() => newSessionNameRef.current?.focus(), 20);
  }, [newSessionOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setCommandOpen(true);
        return;
      }
      if (event.key !== "Escape") return;
      setCommandOpen(false);
      setNewSessionOpen(false);
      setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!newSessionOpen) return;
    let active = true;
    setNewSessionModelsLoading(true);
    setNewSessionError("");
    api
      .getModels()
      .then((result) => {
        if (!active) return;
        const models = Array.isArray(result.models) ? result.models : [];
        setNewSessionModels(models);
        setNewSessionModelKey(models[0] ? modelKey(models[0]) : "");
      })
      .catch((error) => {
        if (active) setNewSessionError(error instanceof Error ? error.message : "无法加载模型");
      })
      .finally(() => {
        if (active) setNewSessionModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [newSessionOpen]);

  const closeDrawers = () => {
    setSidebarOpen(false);
  };

  const openNewSession = () => {
    setCommandOpen(false);
    setNewSessionName("");
    setNewSessionDir("");
    setNewSessionDirPicker(false);
    setNewSessionModelKey("");
    setNewSessionModels([]);
    setNewSessionError("");
    setNewSessionOpen(true);
  };

  const createSession = async () => {
    if (creating) return;
    setCreating(true);
    setNewSessionError("");
    try {
      const created = await api.createSession({ name: newSessionName.trim() || undefined });
      pendingDefaults.current = {
        sessionId: created.id,
        dir: newSessionDir,
        modelKey: newSessionModelKey,
      };
      setSessions((previous) => [created, ...previous.filter((session) => session.id !== created.id)]);
      setNewSessionOpen(false);
      closeDrawers();
      navigate(`/sessions/${created.id}`);
    } catch (error) {
      setNewSessionError(error instanceof Error ? error.message : "创建会话失败");
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async (session: SessionView) => {
    if (deleting || !window.confirm("删除这个会话？pi 会话文件仍会保留在磁盘上。")) return;
    setDeleting(session.id);
    try {
      await api.deleteSession(session.id);
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (session.id === id) navigate(remaining[0] ? `/sessions/${remaining[0].id}` : "/", { replace: true });
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "删除会话失败");
    } finally {
      setDeleting("");
    }
  };

  const logout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const name = state?.sessionName || current?.name || "新会话";
  const commitName = () => {
    const next = nameDraft.trim();
    if (!next || next === name) {
      setEditingName(false);
      return;
    }
    if (setSessionName(next)) {
      setSessions((previous) => previous.map((session) => session.id === id ? { ...session, name: next } : session));
      setEditingName(false);
    }
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
      pendingFirstPrompt.current = {
        sessionId: current.id,
        message,
        images,
        thinkingLevel: draftThinkingLevel === "default" ? undefined : draftThinkingLevel,
      };
      setSessions((previous) => previous.map((session) => session.id === prepared.id ? prepared : session));
      return true;
    } catch (error) {
      setFirstPromptError(error instanceof Error ? error.message : "启动会话失败");
      return false;
    }
  };

  const todaySessions = useMemo(() => sessions.filter((session) => isToday(session.lastActiveAt)), [sessions]);
  const olderSessions = useMemo(() => sessions.filter((session) => !isToday(session.lastActiveAt)), [sessions]);
  const normalizedQuery = commandQuery.trim().toLocaleLowerCase();
  const commandSessions = sessions.filter((session) => {
    const haystack = `${session.name} ${session.cwd}`.toLocaleLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });
  const showCreateCommand = !normalizedQuery || "新建会话 创建 工作目录 模型".includes(normalizedQuery);
  const showSettingsCommand = !normalizedQuery || "设置 模型 可用 pi agent".includes(normalizedQuery);
  const renderSessionGroup = (label: string, entries: SessionView[]) => {
    if (entries.length === 0) return null;
    return (
      <div className="session-group">
        <div className="section-label"><span>{label}</span><span>{entries.length}</span></div>
        {entries.map((session) => {
          const active = session.id === id;
          const sessionName = active ? state?.sessionName || session.name : session.name;
          const subtitle = session.pending
            ? active && selectedDir ? selectedDir : "首条消息时选择工作目录"
            : session.cwd;
          const live = active ? processStatus === "running" && wsStatus === "open" : session.running;
          return (
            <div key={session.id} className="session-item-wrap">
              <button
                type="button"
                onClick={() => {
                  navigate(`/sessions/${session.id}`);
                  closeDrawers();
                }}
                className={`session-item${active ? " active" : ""}`}
              >
                <span className={`status-dot${live ? " live" : ""}`} />
                <span className="session-copy">
                  <span className="session-title">{sessionName || "新会话"}</span>
                  <span className="session-path">{subtitle ? shortPath(subtitle) : "默认工作区"}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void deleteSession(session)}
                disabled={deleting === session.id}
                className="session-delete"
                title="删除会话"
                aria-label={`删除 ${sessionName || "新会话"}`}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const composerSetup = current?.pending ? (
    <div className="pending-setup">
      <div className="pending-row">
        <span className="pending-label">工作目录</span>
        <div className="pending-control">
          <span className="pending-folder" title={selectedDir || "首条消息时创建默认工作区"}>
            <FolderIcon />
            <span>{selectedDir || "首条消息时创建默认工作区"}</span>
          </span>
          {selectedDir && <button type="button" className="text-button" onClick={() => setSelectedDir("")}>使用默认</button>}
          <button type="button" className="text-button" onClick={() => setDirPickerOpen((value) => !value)}>
            {dirPickerOpen ? "收起" : "选择"}
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
      {draftModelError && <p className="form-error">{draftModelError}</p>}
      {firstPromptError && <p className="form-error">{firstPromptError}</p>}
    </div>
  ) : null;

  const composerControls = current?.pending ? (
    <DraftModelPicker
      models={draftModels}
      modelValue={draftModelKey}
      thinkingLevel={draftThinkingLevel}
      disabled={draftModelLoading}
      onModel={setDraftModelKey}
      onThinking={setDraftThinkingLevel}
    />
  ) : current ? (
      <ModelPicker
        sessionId={id}
        state={state}
        disabled={wsStatus !== "open"}
        onModel={setModel}
        onThinking={setThinkingLevel}
      />
  ) : null;

  return (
    <div className="app-shell">
      <div className={`overlay${sidebarOpen ? " visible" : ""}`} onClick={closeDrawers} />

      <aside className={`sidebar${sidebarOpen ? " visible" : ""}`} aria-label="会话导航">
        <div className="brand-row">
          <span className="brand-mark"><PodiumIcon /></span>
          <span className="brand-name">Podium</span>
          <span className="brand-version">0.1</span>
          <ThemeToggle />
          <button type="button" className="icon-btn mobile-only" onClick={closeDrawers} aria-label="关闭会话导航">
            <CloseIcon />
          </button>
        </div>

        <div className="sidebar-actions">
          <button type="button" className="btn" onClick={openNewSession} disabled={creating}>
            <PlusIcon />
            新建会话
          </button>
        </div>

        <nav className="session-nav" aria-label="会话列表">
          {!sessionsLoaded && <p className="session-empty">正在加载会话…</p>}
          {sessionsError && <p className="session-error">{sessionsError}</p>}
          {sessionsLoaded && sessions.length === 0 && !sessionsError && <p className="session-empty">还没有会话。</p>}
          {renderSessionGroup("今天", todaySessions)}
          {renderSessionGroup("更早", olderSessions)}
        </nav>

        <div className="sidebar-footer">
          <Link to="/settings" className="nav-link" onClick={closeDrawers}>
            <SettingsIcon />
            设置与模型
          </Link>
          <button type="button" onClick={logout} className="nav-link">
            <SignOutIcon />
            退出登录
          </button>
        </div>
      </aside>

      <main className="main-column">
        <header className="mobile-bar">
          <button type="button" className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="打开会话导航">
            <MenuIcon />
          </button>
          <span className="mobile-title">{current ? name : "Podium"}</span>
          {current && (
            <RuntimeStatus
              current={current}
              state={state}
              stats={stats}
              processStatus={processStatus}
              wsStatus={wsStatus}
              isStreaming={isStreaming}
              compacting={compacting}
              queue={queue}
              pendingDirectory={selectedDir}
              onCompact={compact}
              onAbort={abort}
            />
          )}
        </header>

        <header className="workspace-header">
          <div className="workspace-identity">
            {current && editingName ? (
              <input
                value={nameDraft}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitName();
                  if (event.key === "Escape") setEditingName(false);
                }}
                className="workspace-title-input"
                aria-label="会话名称"
              />
            ) : current ? (
              <button
                type="button"
                disabled={current.pending || wsStatus !== "open"}
                onClick={() => {
                  setNameDraft(name);
                  setEditingName(true);
                }}
                className="workspace-title-button"
                title={current.pending ? "会话启动后可重命名" : "重命名会话"}
              >
                {name}
              </button>
            ) : (
              <div className="workspace-title-button">Podium</div>
            )}
          </div>
          <div className="workspace-tools">
            {current && (
              <RuntimeStatus
                current={current}
                state={state}
                stats={stats}
                processStatus={processStatus}
                wsStatus={wsStatus}
                isStreaming={isStreaming}
                compacting={compacting}
                queue={queue}
                pendingDirectory={selectedDir}
                onCompact={compact}
                onAbort={abort}
              />
            )}
          </div>
        </header>

        {!current ? (
          <div className="empty-chat">
            <div>
              <span className="empty-chat-mark"><PodiumIcon /></span>
              <p>{sessionsLoaded && sessions.length === 0 ? "创建第一个会话开始协作。" : "选择一个会话继续。"}</p>
              <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={openNewSession}>
                <PlusIcon />新建会话
              </button>
            </div>
          </div>
        ) : (
          <>
            <MessageStream items={items} />
            <Composer
              isStreaming={current.pending ? false : isStreaming}
              onAbort={abort}
              onSend={handleSend}
              setup={composerSetup}
              controls={composerControls}
              disabled={!current.pending && wsStatus !== "open"}
            />
          </>
        )}
      </main>

      {commandOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="快捷操作" onMouseDown={(event) => event.target === event.currentTarget && setCommandOpen(false)}>
          <div className="dialog command-dialog">
            <div className="command-wrap">
              <input
                ref={commandSearchRef}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                className="command-input"
                placeholder="搜索会话或操作…"
                aria-label="搜索快捷操作"
                autoComplete="off"
              />
            </div>
            <div className="command-results">
              {(showCreateCommand || showSettingsCommand) && <div className="command-section-label">操作</div>}
              {showCreateCommand && (
                <button type="button" className="command-item" onClick={openNewSession}>
                  <PlusIcon />
                  <span className="command-copy"><span>新建会话</span><small>选择目录与模型后开始</small></span>
                  <span className="kbd">N</span>
                </button>
              )}
              {showSettingsCommand && (
                <button type="button" className="command-item" onClick={() => navigate("/settings")}>
                  <SettingsIcon />
                  <span className="command-copy"><span>打开设置与模型</span><small>查看 pi Agent 当前可用模型</small></span>
                  <span className="kbd">S</span>
                </button>
              )}
              {commandSessions.length > 0 && <div className="command-section-label">会话</div>}
              {commandSessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={`command-item${session.id === id ? " active" : ""}`}
                  onClick={() => {
                    navigate(`/sessions/${session.id}`);
                    setCommandOpen(false);
                    closeDrawers();
                  }}
                >
                  <span className={`status-dot${session.running ? " live" : ""}`} />
                  <span className="command-copy"><span>{session.name || "新会话"}</span><small>{session.cwd ? shortPath(session.cwd) : "等待选择工作目录"}</small></span>
                  <span />
                </button>
              ))}
              {!showCreateCommand && !showSettingsCommand && commandSessions.length === 0 && (
                <p className="dialog-empty">没有匹配的操作或会话。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {newSessionOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-session-title" onMouseDown={(event) => event.target === event.currentTarget && setNewSessionOpen(false)}>
          <form
            className="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void createSession();
            }}
          >
            <div className="dialog-header">
              <div>
                <h2 className="dialog-title" id="new-session-title">创建新会话</h2>
                <p className="dialog-subtitle">先锁定工作目录和模型，首条消息发送后启动 Agent。</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setNewSessionOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>
            <div className="dialog-body">
              <div className="field">
                <label htmlFor="session-name">会话名称</label>
                <input
                  id="session-name"
                  ref={newSessionNameRef}
                  value={newSessionName}
                  onChange={(event) => setNewSessionName(event.target.value)}
                  maxLength={256}
                  placeholder="例如：修复移动端导航"
                />
              </div>
              <div className="field">
                <label>工作目录</label>
                <RecentDirectorySelect
                  value={newSessionDir}
                  onChange={setNewSessionDir}
                  onBrowse={() => setNewSessionDirPicker(true)}
                  onOpenChange={(open) => {
                    if (open) setNewSessionDirPicker(false);
                  }}
                />
                {newSessionDirPicker && (
                  <DirPicker
                    onSelect={(directory) => {
                      setNewSessionDir(directory);
                      setNewSessionDirPicker(false);
                    }}
                    onCancel={() => setNewSessionDirPicker(false)}
                  />
                )}
              </div>
              <div className="field">
                <label htmlFor="session-model">模型</label>
                <select
                  id="session-model"
                  value={newSessionModelKey}
                  onChange={(event) => setNewSessionModelKey(event.target.value)}
                  disabled={newSessionModelsLoading}
                >
                  {newSessionModels.length === 0 && <option value="">{newSessionModelsLoading ? "正在加载模型…" : "pi 默认模型"}</option>}
                  {newSessionModels.map((model) => (
                    <option key={modelKey(model)} value={modelKey(model)}>{model.name} · {model.provider}</option>
                  ))}
                </select>
              </div>
              {newSessionError && <p className="form-error" style={{ marginTop: 14 }}>{newSessionError}</p>}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" onClick={() => setNewSessionOpen(false)}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? "正在创建…" : "创建会话"}
              </button>
            </div>
          </form>
        </div>
      )}

      {uiRequest && <ExtensionUiModal request={uiRequest} onAnswer={answerUi} />}
      <Toasts />
    </div>
  );
}
