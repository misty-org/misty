import { describe, expect, it } from "vitest";
import { companionReply, resolveFocus } from "../companion/companionReply";
import type { DisplayCapture } from "../companion/protocol";
import { applyLessonReply, lessonProgress, lessonTurnPayload, routeTarget } from "./lessonRouter";
import type { Lesson } from "./lessonTypes";

const now = "2026-10-19T20:00:00.000Z";
const lesson = (id: string, patch: Partial<Lesson> = {}): Lesson => ({
  id,
  title: id,
  objectives: [],
  answerPolicy: "hints",
  hintLevel: "nudge",
  status: "active",
  appliedRuns: ["run-0"],
  createdAt: now,
  updatedAt: now,
  ...patch,
});

describe("lesson replies", () => {
  it("reads the route, focus and lesson tags and never shows them", () => {
    const reply = companionReply(
      "[ROUTE:new:two sum]\nfirst, make an empty dictionary inside " +
        'twoSum.\n[FOCUS:120,180,860,520:screen1]\n[LESSON:{"title":"two ' +
        'sum","objectives":[{"id":"o1","title":"dict","status":"in_progress"}],"current":"o1"}]',
    );
    expect(reply.text).toBe("first, make an empty dictionary inside twoSum.");
    expect(reply.route).toEqual({ kind: "new", title: "two sum" });
    expect(reply.focus).toEqual([{ x1: 120, y1: 180, x2: 860, y2: 520, screen: "screen1" }]);
    expect(reply.lesson?.current).toBe("o1");
  });

  it("hides a tag still streaming in", () => {
    expect(companionReply("good. now loop over the list.\n[LESS").text).toBe(
      "good. now loop over the list.",
    );
    expect(companionReply('ok.\n[LESSON:{"notes":"loo').text).toBe("ok.");
  });

  it("maps a focus region to the screen through its capture", () => {
    const capture = {
      screen: "screen1",
      primary: true,
      width: 1000,
      height: 500,
      display: { id: 7, x: 100, y: 50, width: 2000, height: 1000, scale: 2 },
    } as DisplayCapture;
    expect(
      resolveFocus({ x1: 100, y1: 100, x2: 300, y2: 200, screen: "screen1" }, [capture]),
    ).toEqual({ displayId: 7, frame: { x: 300, y: 250, width: 400, height: 200 } });
  });
});

describe("lesson routing", () => {
  it("starts a lesson in a fresh chat and keeps one lesson active", () => {
    const lessons = { old: lesson("old") };
    expect(routeTarget(lessons, "chat", { kind: "new", title: "two sum" })).toEqual({
      kind: "here",
    });
    const next = applyLessonReply(lessons, {
      lessonId: "chat",
      runId: "run-1",
      route: { kind: "new", title: "two sum" },
      patch: { objectives: [{ id: "o1", title: "dict", status: "in_progress" }], current: "o1" },
      now,
    });
    expect(next.chat).toMatchObject({ title: "two sum", status: "active", previousId: "old" });
    expect(next.old.status).toBe("paused");
    expect(applyLessonReply(next, { lessonId: "chat", runId: "run-1", now })).toBe(next);
  });

  it("moves a new topic out of a lesson that has begun, and resumes paused ones", () => {
    const lessons = { a: lesson("a"), b: lesson("b", { status: "paused" }) };
    expect(routeTarget(lessons, "a", { kind: "new", title: "binary search" })).toEqual({
      kind: "new",
      title: "binary search",
    });
    expect(routeTarget(lessons, "a", { kind: "resume", id: "b" })).toEqual({
      kind: "resume",
      id: "b",
    });
    expect(routeTarget(lessons, "a", { kind: "resume", id: "missing" })).toEqual({ kind: "here" });
    expect(routeTarget(lessons, "a", { kind: "continue" })).toEqual({ kind: "here" });
  });

  it("never turns another chat or a finished lesson into a new lesson", () => {
    expect(routeTarget({}, "auto-chat", { kind: "continue" }, true)).toEqual({
      kind: "new",
      title: "Lesson",
    });
    const finished = { a: lesson("a", { status: "finished" }) };
    expect(routeTarget(finished, "a", { kind: "continue" })).toEqual({
      kind: "new",
      title: "Lesson",
    });
  });

  it("finishes with a summary and counts progress", () => {
    const objectives = [
      { id: "o1", title: "dict", status: "done" as const },
      { id: "o2", title: "loop", status: "skipped" as const },
      { id: "o3", title: "return", status: "pending" as const },
    ];
    const next = applyLessonReply(
      { a: lesson("a", { objectives }) },
      {
        lessonId: "a",
        runId: "run-2",
        patch: { status: "finished", summary: "You built a one-pass lookup." },
        now,
      },
    );
    expect(next.a).toMatchObject({ status: "finished", summary: "You built a one-pass lookup." });
    expect(lessonProgress(next.a)).toBe("2 of 3");
  });

  it("sends the current lesson and recent paused ones", () => {
    const stale = new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString();
    const lessons = {
      a: lesson("a", { answerPolicy: "code" }),
      b: lesson("b", { status: "paused" }),
      c: lesson("c", { status: "paused", updatedAt: stale }),
    };
    const payload = lessonTurnPayload(lessons, "a", Date.parse(now));
    expect(payload.lesson).toMatchObject({ id: "a", answer_policy: "code" });
    expect(payload.lessonIndex.map((item) => item.id)).toEqual(["b"]);
  });
});
