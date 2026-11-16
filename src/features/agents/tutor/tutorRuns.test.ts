import { describe, expect, it, vi } from "vitest";
import type { TutorJob } from "./tutorTypes";
import {
  chats,
  dismissJob,
  fakes,
  finish,
  follow,
  job,
  jobOf,
  retryJob,
  runOf,
  setChats,
  startRun,
  tutor,
} from "./tutorRuns.testFixtures";

describe("a Create job", () => {
  it("runs on the default engine with no chat, leaving what the person has open alone", async () => {
    await follow();
    const started = await job({ kind: "deck" });

    expect(started).toMatchObject({ state: "running", agentId: "personal_engine_claude" });
    expect(fakes.runOnEngine).toHaveBeenCalledTimes(1);
    expect(fakes.runOnEngine.mock.calls[0][0]).toMatchObject({
      prompt: "Make it",
      key: `${started.id}:0`,
    });
    expect(runOf(started.id)).toBe("run-1");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
    expect(chats().selectedAgentId).toBe("agent-mine");
    expect(chats().activeConversationId).toBe("chat-elsewhere");
  });

  it("fails at once when there's no default engine", async () => {
    await follow();
    fakes.engine = undefined;
    const started = await job({ kind: "deck" });
    expect(started).toMatchObject({
      state: "failed",
      error: "Pick a default engine in Settings › Agents.",
    });
    expect(fakes.runOnEngine).not.toHaveBeenCalled();
  });

  it("reads a finished deck answer into a deck in the notebook", async () => {
    await follow();
    const started = await job({ kind: "deck", title: "Flashcards: Volcanoes" });
    await finish(
      runOf(started.id),
      'Here you go:\n```json\n{"title": "Lava", "cards": [{"front": "Magma?", "back": "Molten rock"}, {"front": "Vent?", "back": "An opening"}]}\n```',
    );

    const done = jobOf(started.id);
    expect(done.state).toBe("done");
    const deck = tutor().decks[done.resultId!];
    expect(deck).toMatchObject({ title: "Lava", notebookId: "n1" });
    expect(deck.cards.map((card) => card.front)).toEqual(["Magma?", "Vent?"]);
  });

  it("names a deck after its topic when the answer gives no title", async () => {
    await follow();
    const started = await job({ kind: "deck", title: "Flashcards: Volcanoes" });
    await finish(runOf(started.id), '{"cards": [{"front": "a", "back": "b"}]}');
    expect(tutor().decks[jobOf(started.id).resultId!].title).toBe("Volcanoes");
  });

  const replies: {
    name: string;
    kind: TutorJob["kind"];
    report?: string;
    reply: string;
    expected: Record<string, unknown>;
  }[] = [
    {
      name: "quiz",
      kind: "quiz",
      reply:
        '{"title": "Lava quiz", "questions": [{"question": "Hot?", "choices": ["Yes", "No"], "answer": 0}]}',
      expected: { kind: "quiz", title: "Lava quiz" },
    },
    {
      name: "mind map",
      kind: "mindmap",
      reply: '{"title": "Lava map", "root": {"label": "Lava", "children": [{"label": "Flows"}]}}',
      expected: { kind: "mindmap", title: "Lava map", map: { label: "Lava" } },
    },
    {
      name: "slides",
      kind: "slides",
      reply: "# Lava deck\n\n- hot\n\n---\n\n## Flows\n\n- slow",
      expected: { kind: "slides", title: "Lava deck" },
    },
    {
      name: "FAQ report",
      kind: "guide",
      report: "faq",
      reply: "# Lava FAQ\n\n**Is it hot?** Yes.",
      expected: { kind: "guide", report: "faq", title: "Lava FAQ" },
    },
    {
      name: "data table",
      kind: "guide",
      report: "data-table",
      reply: "# Lava table\n\n| Kind | Temp |\n| --- | --- |\n| Basalt | 1200 |",
      expected: { kind: "guide", report: "data-table", title: "Lava table" },
    },
    {
      name: "infographic",
      kind: "infographic",
      reply: '```svg\n<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n```',
      expected: { kind: "infographic", title: "Volcanoes" },
    },
    {
      name: "audio overview",
      kind: "overview",
      reply:
        '{"title": "Lava talk", "lines": [{"speaker": "A", "text": "Hi"}, {"speaker": "B", "text": "Hello"}]}',
      expected: { kind: "overview", title: "Lava talk", audio: { state: "making" } },
    },
    {
      name: "video overview",
      kind: "video",
      reply: JSON.stringify({
        title: "Lava film",
        scenes: [
          { heading: "One", narration: "First.", svg: "<svg viewBox='0 0 1 1'></svg>" },
          { heading: "Two", narration: "Second." },
        ],
      }),
      expected: { kind: "video", title: "Lava film", audio: { state: "making" } },
    },
  ];

  it.each(replies)(
    "reads a finished $name answer into what Create shows",
    async ({ kind, report, reply, expected }) => {
      await follow();
      const started = await job({ kind, report });
      await finish(runOf(started.id), reply);

      const done = jobOf(started.id);
      expect(done.state).toBe("done");
      expect(tutor().guides[done.resultId!]).toMatchObject({ ...expected, notebookId: "n1" });
    },
  );

  it("starts the narration of an audio or video overview once its script is in", async () => {
    await follow();
    const overview = await job({ kind: "overview" });
    await finish(runOf(overview.id), replies.find((item) => item.kind === "overview")!.reply);
    expect(fakes.makeOverviewAudio).toHaveBeenCalledWith(jobOf(overview.id).resultId);

    const video = await job({ kind: "video" });
    await finish(runOf(video.id), replies.find((item) => item.kind === "video")!.reply);
    expect(fakes.makeVideoAudio).toHaveBeenCalledWith(jobOf(video.id).resultId);
  });

  it.each([
    ["deck", "Sorry, I can't make cards from this."],
    ["quiz", '{"questions": [{"question": "Hot?", "choices": ["Yes"], "answer": 0}]}'],
    ["mindmap", '{"root": {"label": "Lava"}}'],
    ["slides", "# Only one slide"],
    ["infographic", "No drawing here."],
    ["video", '{"scenes": [{"heading": "One", "narration": "Only one."}]}'],
    ["overview", '{"lines": [{"speaker": "A", "text": "Alone"}]}'],
  ] as const)("fails a %s answer it can't use, and makes nothing", async (kind, reply) => {
    await follow();
    const started = await job({ kind });
    await finish(runOf(started.id), reply);

    expect(jobOf(started.id)).toMatchObject({
      state: "failed",
      error: "The reply had nothing Misty could use.",
    });
    expect(Object.keys(tutor().guides)).toHaveLength(0);
    expect(Object.keys(tutor().decks)).toHaveLength(0);
  });

  it.each([
    ["", "The model is over its rate limit.", "The model is over its rate limit."],
    [
      '{"title": "half a de',
      "This run stopped before it finished.",
      "This run stopped before it finished.",
    ],
    ["", "Stopped.", "Stopped."],
  ] as const)("says why a run that ended with %j failed", async (text, error, expected) => {
    await follow();
    const started = await job({ kind: "deck" });
    await finish(runOf(started.id), text, error);
    expect(jobOf(started.id)).toMatchObject({ state: "failed", error: expected });
  });

  it("fails with the reason when the run can't start", async () => {
    await follow();
    fakes.runOnEngine.mockRejectedValueOnce(new Error("No engine is signed in."));
    const started = await job({ kind: "deck" });
    await vi.waitFor(() =>
      expect(jobOf(started.id)).toMatchObject({
        state: "failed",
        error: "No engine is signed in.",
      }),
    );
  });
});

describe("several jobs", () => {
  it("run side by side, with no turn to wait for", async () => {
    await follow();
    setChats({ working: true });
    const first = await job({ kind: "deck" });
    const second = await job({ kind: "quiz" });

    expect(first.state).toBe("running");
    expect(second.state).toBe("running");
    expect(fakes.runOnEngine).toHaveBeenCalledTimes(2);
  });
});

describe("trying again", () => {
  it("starts a new run for a job that failed", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    await finish(runOf(started.id), "", "The model is over its rate limit.");

    const retried = await retryJob(jobOf(started.id));
    expect(retried).toMatchObject({ state: "running", error: undefined, restarts: 1 });
    expect(fakes.runOnEngine).toHaveBeenCalledTimes(2);
    expect(fakes.runOnEngine.mock.calls[1][0]).toMatchObject({ key: `${started.id}:1` });

    await finish(runOf(started.id), '{"cards": [{"front": "a", "back": "b"}]}');
    expect(jobOf(started.id).state).toBe("done");
  });

  it("stops a running job's run and drops the job", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    const runId = runOf(started.id);
    await dismissJob(jobOf(started.id));
    expect(fakes.stopEngineRun).toHaveBeenCalledWith(runId);
    expect(jobOf(started.id)).toBeUndefined();
  });

  it("ignores an answer that arrives after the job was dropped", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    const runId = runOf(started.id);
    await dismissJob(jobOf(started.id));
    await finish(runId, '{"cards": [{"front": "a", "back": "b"}]}');
    expect(jobOf(started.id)).toBeUndefined();
    expect(Object.keys(tutor().decks)).toHaveLength(0);
  });
});

describe("a chat turn (a pick-up's draft)", () => {
  it("opens as a teach-mode chat when asked to", async () => {
    const run = await startRun({
      agentId: "agent-1",
      title: "Volcanoes",
      prompt: "Teach me",
      mode: "teach",
      background: false,
    });
    expect(run.started).toBe(true);
    expect(fakes.setMode).toHaveBeenCalledWith(run.conversationId, "teach");
    expect(fakes.submitAnswer.mock.calls[0][5]).toMatchObject({ collaborationMode: "teach" });
    expect(fakes.submitAnswer.mock.calls[0][5]).not.toHaveProperty("permissionMode");
    expect(chats().selectedAgentId).toBe("agent-1");
  });

  it("doesn't start while another turn is working", async () => {
    setChats({ working: true });
    const run = await startRun({
      agentId: "agent-1",
      title: "Volcanoes",
      prompt: "Teach me",
      mode: "teach",
      background: false,
    });
    expect(run.started).toBe(false);
    expect(run.error).toBeUndefined();
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });
});
