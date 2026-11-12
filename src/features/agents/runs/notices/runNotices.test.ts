import { describe, expect, it } from "vitest";
import type { AiInvocationEvent } from "../invocations/invocationTypes";
import {
  RunNoticeTracker,
  noticeKindOf,
  noticeRoute,
  noticeTitle,
  type NoticeRun,
} from "./runNotices";

const since = Date.parse("2026-11-11T10:00:00Z");

function run(state: string, extra: Partial<NoticeRun> = {}): NoticeRun {
  return {
    run_id: "r1",
    state,
    conversation_id: "c1",
    agent_id: "a1",
    parent_run_id: "",
    delegation_depth: 0,
    updated_at: "2026-11-11T10:05:00Z",
    ...extra,
  };
}

const event = (value: Record<string, unknown>) =>
  ({ id: "e", ...value }) as unknown as AiInvocationEvent;

function seeded(entries: NoticeRun[] = []) {
  const tracker = new RunNoticeTracker(since);
  tracker.update(entries);
  return tracker;
}

describe("noticeKindOf", () => {
  it("names what the person would want to hear", () => {
    expect(noticeKindOf("completed")).toBe("finished");
    expect(noticeKindOf("failed")).toBe("failed");
    expect(noticeKindOf("awaiting_approval")).toBe("needs-you");
    expect(noticeKindOf("awaiting_intervention")).toBe("needs-you");
    expect(noticeKindOf("running")).toBeNull();
    expect(noticeKindOf("canceled")).toBeNull();
    expect(noticeKindOf("running", "asking")).toBe("needs-you");
    expect(noticeKindOf("completed", "handoff")).toBe("needs-you");
  });
});

describe("RunNoticeTracker", () => {
  it("says nothing about what was there on the first look", () => {
    const tracker = new RunNoticeTracker(since);
    expect(tracker.update([run("completed")])).toEqual([]);
    expect(tracker.update([run("completed")])).toEqual([]);
  });

  it("tells each transition once", () => {
    const tracker = seeded([run("running")]);
    expect(tracker.update([run("running")])).toEqual([]);
    expect(tracker.update([run("completed")])).toEqual([
      { runId: "r1", kind: "finished", conversationId: "c1", agentId: "a1" },
    ]);
    expect(tracker.update([run("completed")])).toEqual([]);
  });

  it("tells a failure and a wait for the person", () => {
    const tracker = seeded([
      run("running"),
      run("running", { run_id: "r2", conversation_id: "c2" }),
    ]);
    const notices = tracker.update([
      run("failed"),
      run("awaiting_approval", { run_id: "r2", conversation_id: "c2" }),
    ]);
    expect(notices.map((notice) => notice.kind)).toEqual(["failed", "needs-you"]);
  });

  it("asks again only after the run worked again", () => {
    const tracker = seeded([run("running")]);
    expect(tracker.update([run("awaiting_approval")])).toHaveLength(1);
    expect(tracker.update([run("awaiting_approval")])).toHaveLength(0);
    expect(tracker.update([run("running")])).toHaveLength(0);
    expect(tracker.update([run("awaiting_approval")])).toHaveLength(1);
  });

  it("counts a resume it never saw between two polls", () => {
    const tracker = seeded([run("running")]);
    expect(tracker.update([run("awaiting_approval")])).toHaveLength(1);
    tracker.noteEvent("r1", event({ type: "tool.started", toolCallId: "t", toolName: "x" }));
    expect(tracker.update([run("awaiting_approval")])).toHaveLength(1);
  });

  it("leaves out sub-agents", () => {
    const tracker = seeded();
    expect(
      tracker.update([
        run("completed", { run_id: "s1", delegation_depth: 1, conversation_id: "c9" }),
        run("failed", { run_id: "s2", parent_run_id: "r1", conversation_id: "c8" }),
      ]),
    ).toEqual([]);
  });

  it("follows only each chat's newest run", () => {
    const tracker = seeded();
    const notices = tracker.update([
      run("failed", { run_id: "old", updated_at: "2026-11-11T10:01:00Z" }),
      run("completed", { run_id: "new", updated_at: "2026-11-11T10:06:00Z" }),
    ]);
    expect(notices.map((notice) => notice.runId)).toEqual(["new"]);
  });

  it("ignores a run first seen later that ended before it was looking", () => {
    const tracker = seeded();
    expect(tracker.update([run("completed", { updated_at: "2026-11-11T09:00:00Z" })])).toEqual([]);
  });

  it("tells a run that started and ended between two looks", () => {
    const tracker = seeded();
    expect(tracker.update([run("completed")])).toHaveLength(1);
  });

  it("hears an engine's question while the run still reads as running", () => {
    const tracker = seeded([run("running")]);
    tracker.noteEvent("r1", event({ type: "engine.question", requestId: "q", questions: [] }));
    tracker.noteEvent("r1", event({ type: "assistant.status", phase: "awaiting_input" }));
    expect(tracker.update([run("running")]).map((notice) => notice.kind)).toEqual(["needs-you"]);
    tracker.noteEvent("r1", event({ type: "engine.question_settled", requestId: "q" }));
    expect(tracker.update([run("running")])).toEqual([]);
  });

  it("hears a plan waiting for review, once", () => {
    const tracker = seeded([run("running")]);
    tracker.noteEvent(
      "r1",
      event({ type: "engine.plan_review", review: { status: "awaiting_review" } }),
    );
    expect(tracker.update([run("running")])).toHaveLength(1);
    expect(tracker.update([run("completed")])).toEqual([]);
  });

  it("reads a run that ended on a question as needing the person", () => {
    const tracker = seeded([run("running")]);
    tracker.noteEvent(
      "r1",
      event({
        type: "tool.completed",
        toolCallId: "t",
        toolName: "ask_user",
        result: JSON.stringify({ status: "awaiting_answer" }),
      }),
    );
    expect(tracker.update([run("completed")]).map((notice) => notice.kind)).toEqual(["needs-you"]);
  });

  it("says nothing when a run is canceled", () => {
    const tracker = seeded([run("running")]);
    expect(tracker.update([run("canceled")])).toEqual([]);
  });
});

describe("notice text", () => {
  it("names the agent and what happened", () => {
    expect(noticeTitle("Codex", "finished")).toBe("Codex finished");
    expect(noticeTitle("Codex", "failed")).toBe("Codex failed");
    expect(noticeTitle(" ", "needs-you")).toBe("Your agent needs you");
  });

  it("opens the chat", () => {
    expect(noticeRoute("a1", "c1")).toBe("/agents?agent=a1&conversation=c1");
    expect(noticeRoute("", "c1")).toBe("/agents?conversation=c1");
  });
});
