import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../types";
import { applyEvent, buildItemsFromEntries } from "./chatModel";

const timestamp = "2026-01-01T00:00:00Z";

describe("buildItemsFromEntries", () => {
  it("follows leafId and excludes abandoned branches", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "user",
        parentId: null,
        timestamp,
        message: { role: "user", content: "question" },
      },
      {
        type: "message",
        id: "abandoned",
        parentId: "user",
        timestamp,
        message: { role: "assistant", content: "wrong branch" },
      },
      {
        type: "message",
        id: "assistant",
        parentId: "user",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "active answer" },
            { type: "thinking", thinking: "check the file\nverify contents" },
            { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } },
          ],
        },
      },
      {
        type: "message",
        id: "result",
        parentId: "assistant",
        timestamp,
        message: { role: "toolResult", toolCallId: "call-1", content: "file body" },
      },
    ];

    const items = buildItemsFromEntries(entries, "result");
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant"]);
    expect(items.some((item) => item.kind === "assistant" && item.text === "wrong branch")).toBe(false);
    const assistant = items[1];
    expect(assistant).toMatchObject({ kind: "assistant", id: "assistant", text: "active answer" });
    if (assistant.kind === "assistant") {
      // Thinking precedes the tool call and the toolResult output lands on the
      // same ToolItem referenced by the log entry.
      expect(assistant.exec).toEqual([
        { type: "think", text: "check the file\nverify contents" },
        { type: "tool", tool: expect.objectContaining({ id: "call-1", name: "read", output: "file body" }) },
      ]);
    }
  });
});

describe("applyEvent", () => {
  it("does not mutate the previous item snapshot", () => {
    const original = [
      { kind: "assistant" as const, id: "stream", text: "a", exec: [], streaming: true },
    ];
    const result = applyEvent(original, "stream", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "b" },
    });
    expect(original[0].text).toBe("a");
    expect(result.items[0]).toMatchObject({ text: "ab", streaming: true });
  });

  it("uses the authoritative final assistant message", () => {
    const partial = applyEvent([], null, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "partial" },
    });
    const final = applyEvent(partial.items, partial.streamingAssistantId, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final" }] },
    });
    expect(final.streamingAssistantId).toBeNull();
    expect(final.items[0]).toMatchObject({ kind: "assistant", text: "final", streaming: false });
  });

  it("interleaves thinking segments and tool calls while streaming", () => {
    let result = applyEvent([], null, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "plan first" },
    });
    result = applyEvent(result.items, result.streamingAssistantId, {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "ls" },
    });
    result = applyEvent(result.items, result.streamingAssistantId, {
      type: "tool_execution_end",
      toolCallId: "c1",
      result: { content: [{ type: "text", text: "src\nweb" }] },
    });
    result = applyEvent(result.items, result.streamingAssistantId, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "then decide" },
    });
    const item = result.items[0];
    expect(item.kind).toBe("assistant");
    if (item.kind === "assistant") {
      expect(item.exec).toEqual([
        { type: "think", text: "plan first" },
        {
          type: "tool",
          tool: expect.objectContaining({ id: "c1", name: "bash", output: "src\nweb", running: false }),
        },
        { type: "think", text: "then decide" },
      ]);
    }
  });
});
