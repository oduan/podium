import type { SessionState, SessionStats } from "../../types";

// StatsBar shows the active model, thinking level, token/cost usage and context
// window pressure at the bottom of the chat column.
export function StatsBar({
  state: _state,
  stats,
  compacting,
}: {
  state: SessionState | null;
  stats: SessionStats | null;
  compacting: boolean;
}) {
  const pct = stats?.contextUsage?.percent ?? null;
  const tokens = stats?.tokens?.total ?? stats?.contextUsage?.tokens ?? null;
  const cost = stats?.cost ?? null;

  if (!compacting && tokens == null && cost == null && pct == null) return null;

  return (
    <div className="flex items-center gap-3 border-t border-white/[0.05] bg-ink-900/60 px-5 py-1.5 text-xs text-ink-500">
      <div className="flex-1" />
      {compacting && <span className="text-accent">compacting…</span>}
      {tokens != null && <span>{tokens.toLocaleString()} tok</span>}
      {cost != null && <span>${cost.toFixed(4)}</span>}
      {pct != null && (
        <span className={pct > 85 ? "text-amber-400" : ""}>{Math.round(pct)}% ctx</span>
      )}
    </div>
  );
}
