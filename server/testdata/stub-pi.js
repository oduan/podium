#!/usr/bin/env node
// Stub pi RPC process for integration testing Podium's backend.
// Emulates a tiny subset of `pi --mode rpc`.
"use strict";

const args = process.argv.slice(2);
const noSession = args.includes("--no-session");
let sessionFile = noSession ? "" : require("path").join(process.cwd(), ".stub-session.jsonl");
let sessionName = "";
let entrySeq = 0;
const entries = [];

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(cmd, id, success, data, error) {
  const r = { type: "response", command: cmd, success };
  if (id) r.id = id;
  if (data !== undefined) r.data = data;
  if (error !== undefined) r.error = error;
  out(r);
}

function addEntry(role, content) {
  const id = "e" + ++entrySeq;
  const parentId = entries.length ? entries[entries.length - 1].id : null;
  const entry = { type: "message", id, parentId, timestamp: new Date().toISOString(), message: { role, content } };
  entries.push(entry);
  return id;
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.trim()) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function handle(line) {
  let cmd;
  try { cmd = JSON.parse(line); } catch { return respond("parse", null, false, undefined, "bad json"); }
  const { id, type } = cmd;
  switch (type) {
    case "get_state":
      return respond(type, id, true, {
        model: { id: "stub-model", name: "Stub", provider: "stub" },
        thinkingLevel: "medium", isStreaming: false, isCompacting: false,
        sessionFile, sessionId: "stub-session", sessionName: sessionName || undefined,
        messageCount: entries.length, pendingMessageCount: 0,
      });
    case "set_session_name":
      sessionName = cmd.name || "";
      return respond(type, id, true);
    case "switch_session":
      sessionFile = cmd.sessionPath;
      return respond(type, id, true, { cancelled: false });
    case "get_entries": {
      let list = entries;
      if (cmd.since) {
        const i = entries.findIndex((e) => e.id === cmd.since);
        if (i === -1) return respond(type, id, false, undefined, "unknown since");
        list = entries.slice(i + 1);
      }
      return respond(type, id, true, { entries: list, leafId: entries.length ? entries[entries.length - 1].id : null });
    }
	case "get_available_models":
      return respond(type, id, true, { models: [{ id: "stub-model", name: "Stub", provider: "stub", contextWindow: 200000 }] });
	case "get_available_thinking_levels":
	  return respond(type, id, true, { levels: ["off", "low", "medium", "high"] });
    case "get_session_stats":
      return respond(type, id, true, { sessionFile, sessionId: "stub-session", totalMessages: entries.length, tokens: { total: 0 }, cost: 0 });
    case "prompt": {
      addEntry("user", cmd.message);
      respond(type, id, true);
      // Simulate a streaming assistant reply.
      out({ type: "agent_start" });
      const reply = "Echo: " + cmd.message;
      out({ type: "message_start", message: { role: "assistant", content: [] } });
      for (const ch of reply) {
        out({ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: ch, partial: {} } });
      }
      out({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: reply }] } });
      addEntry("assistant", [{ type: "text", text: reply }]);
      out({ type: "agent_end", messages: [], willRetry: false });
      out({ type: "agent_settled" });
      return;
    }
    case "abort":
      return respond(type, id, true);
    default:
      return respond(type, id, true, {});
  }
}
