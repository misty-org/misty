import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import type { TutorJob } from "./tutorTypes";

/**
 * Tutor's runs end to end in the window: a job starts a hidden chat turn on the person's agent,
 * waits its turn, and its finished reply is read into what Create shows. The chat store is a small
 * stand-in whose `submitAnswer` starts a turn the way the real one reports it.
 */

const fakes = vi.hoisted(() => ({
  submitAnswer: vi.fn(),
  deleteConversation: vi.fn(),
  readRunState: vi.fn(),
  setMode: vi.fn(),
  makeOverviewAudio: vi.fn(),
  makeVideoAudio: vi.fn(),
  addLink: vi.fn(),
  stored: {} as Record<string, unknown[]>,
  chats: 0,
}));

vi.mock("../conversations/state/useMistyStore", async () => {
  const { create } = await import("zustand");
  return { useMistyStore: create(() => ({})) };
});
vi.mock("../conversations/state/localConversation", () => ({
  newLocalConversation: (title: string, _space?: string, agentId?: string) => ({
    id: `chat-${++fakes.chats}`,
    title,
    agentId,
    messages: [],
  }),
}));
vi.mock("../conversations/state/localChats", () => ({
  localChats: {
    tutor: (_account: string, kind: string) => Promise.resolve(fakes.stored[kind] ?? []),
    saveTutor: () => Promise.resolve(),
    deleteTutor: () => Promise.resolve(),
    lessons: () => Promise.resolve([]),
    courses: () => Promise.resolve([]),
  },
}));
vi.mock("../runs/invocations/invocationSubscription", () => ({
  readRunState: fakes.readRunState,
}));
vi.mock("../plans/store", () => ({
  useCollaborationStore: { getState: () => ({ setMode: fakes.setMode }) },
}));
vi.mock("./tutorAudio", () => ({
  makeOverviewAudio: fakes.makeOverviewAudio,
  makeVideoAudio: fakes.makeVideoAudio,
}));
vi.mock("./tutorSources", () => ({ addLink: fakes.addLink }));

const { useMistyStore } = await import("../conversations/state/useMistyStore");
const { useTutorStore } = await import("./tutorStore");
const { dismissJob, followTutorJobs, retryJob, startJob, startRun } = await import("./tutorRuns");

type Chat = Pick<GlobalAiConversation, "id" | "title" | "messages">;
type ChatState = {
  accountId: string;
  conversations: Chat[];
  conversationsLoading: boolean;
  working: boolean;
  selectedAgentId?: string;
  activeConversationId?: string;
  invocationId?: string;
  invocationConversationId?: string;
  error?: string;
};

const chats = () => useMistyStore.getState() as unknown as ChatState;
const setChats = (change: Partial<ChatState>) =>
  useMistyStore.setState(change as Record<string, unknown>);
const tutor = () => useTutorStore.getState();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A chat that is already there, so the window counts as loaded. */
const elsewhere: Chat = { id: "chat-elsewhere", title: "Something else", messages: [] };

/** The turn `submitAnswer` starts: the person's prompt and a reply still on its way. */
function startTurn(_prompt: string, ...rest: unknown[]) {
  const { conversationId } = rest[3] as { conversationId: string };
  const invocationId = `inv-${conversationId}`;
  setChats({
    working: true,
    invocationId,
    invocationConversationId: conversationId,
    activeConversationId: conversationId,
    conversations: chats().conversations.map((chat) =>
      chat.id === conversationId
        ? {
            ...chat,
            messages: [
              { id: "q", role: "user", mode: "ask", content: _prompt, createdAt: "" },
              {
                id: "a",
                role: "assistant",
                mode: "ask",
                content: "",
                createdAt: "",
                state: "pending",
                invocationId,
              },
            ],
          }
        : chat,
    ),
  });
  return Promise.resolve();
}

/** The reply in `conversationId` finishes, and the turn ends. */
function finish(
  conversationId: string,
  content: string,
  state: "completed" | "failed" | "canceled" = "completed",
) {
  setChats({
    working: false,
    conversations: chats().conversations.map((chat) =>
      chat.id === conversationId
        ? {
            ...chat,
            messages: chat.messages.map((message) =>
              message.role === "assistant" ? { ...message, content, state } : message,
            ),
          }
        : chat,
    ),
  });
}

const jobOf = (id: string) => tutor().jobs[id];

let stop: (() => void) | undefined;

async function follow() {
  stop = followTutorJobs("acct");
  await vi.waitFor(() => expect(tutor().ready).toBe(true));
  await flush();
}

function job(input: Partial<TutorJob> & Pick<TutorJob, "kind">) {
  return startJob({
    title: "Topic: Volcanoes",
    agentId: "agent-1",
    notebookId: "n1",
    prompt: "Make it",
    ...input,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.stored = {};
  fakes.submitAnswer.mockImplementation(startTurn);
  fakes.deleteConversation.mockResolvedValue(undefined);
  fakes.setMode.mockResolvedValue(undefined);
  fakes.readRunState.mockResolvedValue("finished");
  fakes.addLink.mockResolvedValue(null);
  useTutorStore.setState({
    accountId: "",
    ready: false,
    notebooks: {},
    decks: {},
    guides: {},
    jobs: {},
  });
  useMistyStore.setState(
    {
      accountId: "acct",
      conversations: [elsewhere],
      conversationsLoading: false,
      working: false,
      selectedAgentId: "agent-mine",
      activeConversationId: elsewhere.id,
      invocationId: undefined,
      invocationConversationId: undefined,
      error: undefined,
      submitAnswer: fakes.submitAnswer,
      deleteConversation: fakes.deleteConversation,
    } as Record<string, unknown>,
    true,
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("a Create job", () => {
  it("runs in a chat of its own and leaves what the person has open alone", async () => {
    await follow();
    const started = await job({ kind: "deck" });

    expect(started.state).toBe("running");
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);
    const [, , , , target, options] = fakes.submitAnswer.mock.calls[0];
    expect(target).toMatchObject({ conversationId: started.conversationId });
    expect(options).toMatchObject({
      executionMode: "user",
      collaborationMode: "act",
      permissionMode: "auto",
    });
    expect(chats().selectedAgentId).toBe("agent-mine");
    expect(chats().activeConversationId).toBe(elsewhere.id);
    expect(chats().conversations.some((chat) => chat.id === started.conversationId)).toBe(true);
  });

  it("reads a finished deck reply into a deck in the notebook", async () => {
    await follow();
    const started = await job({ kind: "deck", title: "Flashcards: Volcanoes" });
    finish(
      started.conversationId,
      'Here you go:\n```json\n{"title": "Lava", "cards": [{"front": "Magma?", "back": "Molten rock"}, {"front": "Vent?", "back": "An opening"}]}\n```',
    );

    const done = jobOf(started.id);
    expect(done.state).toBe("done");
    const deck = tutor().decks[done.resultId!];
    expect(deck).toMatchObject({ title: "Lava", notebookId: "n1" });
    expect(deck.cards.map((card) => card.front)).toEqual(["Magma?", "Vent?"]);
  });

  it("names a deck after its topic when the reply gives no title", async () => {
    await follow();
    const started = await job({ kind: "deck", title: "Flashcards: Volcanoes" });
    finish(started.conversationId, '{"cards": [{"front": "a", "back": "b"}]}');
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
    "reads a finished $name reply into what Create shows",
    async ({ kind, report, reply, expected }) => {
      await follow();
      const started = await job({ kind, report });
      finish(started.conversationId, reply);

      const done = jobOf(started.id);
      expect(done.state).toBe("done");
      expect(tutor().guides[done.resultId!]).toMatchObject({
        ...expected,
        notebookId: "n1",
        conversationId: started.conversationId,
      });
    },
  );

  it("starts the narration of an audio or video overview once its script is in", async () => {
    await follow();
    const overview = await job({ kind: "overview" });
    finish(overview.conversationId, replies.find((item) => item.kind === "overview")!.reply);
    expect(fakes.makeOverviewAudio).toHaveBeenCalledWith(jobOf(overview.id).resultId);

    const video = await job({ kind: "video" });
    finish(video.conversationId, replies.find((item) => item.kind === "video")!.reply);
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
  ] as const)("fails a %s reply it can't use, and makes nothing", async (kind, reply) => {
    await follow();
    const started = await job({ kind });
    finish(started.conversationId, reply);

    expect(jobOf(started.id)).toMatchObject({
      state: "failed",
      error: "The reply had nothing Misty could use.",
    });
    expect(Object.keys(tutor().guides)).toHaveLength(0);
    expect(Object.keys(tutor().decks)).toHaveLength(0);
  });

  it.each([
    ["failed", "The model is over its rate limit.", "The model is over its rate limit."],
    ["failed", '{"title": "half a de', "This run stopped before it finished."],
    ["failed", "", "This run stopped before it finished."],
    ["canceled", "", "This run was stopped."],
  ] as const)("says why a %s reply failed", async (state, content, error) => {
    await follow();
    const started = await job({ kind: "deck" });
    finish(started.conversationId, content, state);
    expect(jobOf(started.id)).toMatchObject({ state: "failed", error });
  });

  it("fails with the reason when the turn can't start", async () => {
    await follow();
    fakes.submitAnswer.mockRejectedValueOnce(new Error("No engine is signed in."));
    const started = await job({ kind: "deck" });
    expect(started).toMatchObject({ state: "failed", error: "No engine is signed in." });
  });
});

describe("waiting for a turn", () => {
  it("waits while another turn is working, then starts when it ends", async () => {
    await follow();
    setChats({ working: true });
    const waiting = await job({ kind: "deck" });

    expect(waiting.state).toBe("queued");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();

    setChats({ working: false });
    await vi.waitFor(() => expect(jobOf(waiting.id).state).toBe("running"));
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("runs two jobs one after the other", async () => {
    await follow();
    const first = await job({ kind: "deck" });
    const second = await job({ kind: "quiz" });

    expect(first.state).toBe("running");
    expect(jobOf(second.id).state).toBe("queued");
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);

    finish(first.conversationId, '{"cards": [{"front": "a", "back": "b"}]}');
    await vi.waitFor(() => expect(jobOf(second.id).state).toBe("running"));
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(2);
  });
});

describe("trying again", () => {
  it("reads a reply that finished again before starting a new turn", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    // Read as unusable once, then the reply is read again as it stands.
    finish(started.conversationId, "nothing");
    expect(jobOf(started.id).state).toBe("failed");
    finish(started.conversationId, '{"cards": [{"front": "a", "back": "b"}]}');

    const retried = await retryJob(jobOf(started.id));
    expect(retried.state).toBe("done");
    expect(tutor().decks[retried.resultId!].cards).toHaveLength(1);
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("starts a new turn in the same chat when there is nothing to read", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    finish(started.conversationId, "The model is over its rate limit.", "failed");

    const retried = await retryJob(jobOf(started.id));
    expect(retried).toMatchObject({ state: "running", error: undefined });
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(2);
    expect(fakes.submitAnswer.mock.calls[1][4]).toMatchObject({
      conversationId: started.conversationId,
    });
  });

  it("drops a job and its chat", async () => {
    await follow();
    const started = await job({ kind: "deck" });
    await dismissJob(jobOf(started.id));
    expect(fakes.deleteConversation).toHaveBeenCalledWith(started.conversationId);
    expect(jobOf(started.id)).toBeUndefined();
  });
});

describe("runs Misty closed under", () => {
  const saved = (change: Partial<TutorJob>): TutorJob => ({
    id: "job-old",
    kind: "deck",
    title: "Flashcards: Volcanoes",
    agentId: "agent-1",
    conversationId: elsewhere.id,
    prompt: "Make it",
    notebookId: "n1",
    state: "failed",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...change,
  });

  it("starts an interrupted run again once", async () => {
    fakes.stored.tutor_job = [saved({ error: "Misty closed before this run finished." })];
    await follow();
    await vi.waitFor(() => expect(jobOf("job-old").state).toBe("running"));
    expect(jobOf("job-old").restarts).toBe(1);
  });

  it("leaves an interrupted run alone once it has been started again", async () => {
    fakes.stored.tutor_job = [
      saved({ error: "Misty closed before this run finished.", restarts: 1 }),
    ];
    await follow();
    expect(jobOf("job-old").state).toBe("failed");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("leaves a run that failed at its own work for the person to retry", async () => {
    fakes.stored.tutor_job = [saved({ error: "The reply had nothing Misty could use." })];
    await follow();
    expect(jobOf("job-old").state).toBe("failed");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("fails a run whose reply waits on a turn that no longer runs, then starts it again", async () => {
    const orphan: Chat = {
      id: "chat-orphan",
      title: "Flashcards: Volcanoes",
      messages: [
        {
          id: "a",
          role: "assistant",
          mode: "ask",
          content: "",
          createdAt: "",
          state: "streaming",
          invocationId: "inv-gone",
        },
      ],
    };
    setChats({ conversations: [elsewhere, orphan] });
    fakes.stored.tutor_job = [saved({ state: "running", conversationId: orphan.id })];
    await follow();

    await vi.waitFor(() => expect(fakes.readRunState).toHaveBeenCalledWith("inv-gone"));
    await vi.waitFor(() => expect(jobOf("job-old").state).toBe("running"));
    expect(jobOf("job-old").restarts).toBe(1);
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting on a run native code still has", async () => {
    fakes.readRunState.mockResolvedValue("running");
    const live: Chat = {
      id: "chat-live",
      title: "Flashcards: Volcanoes",
      messages: [
        {
          id: "a",
          role: "assistant",
          mode: "ask",
          content: "",
          createdAt: "",
          state: "streaming",
          invocationId: "inv-live",
        },
      ],
    };
    setChats({ conversations: [elsewhere, live] });
    fakes.stored.tutor_job = [saved({ state: "running", conversationId: live.id })];
    await follow();

    await vi.waitFor(() => expect(fakes.readRunState).toHaveBeenCalledWith("inv-live"));
    await flush();
    expect(jobOf("job-old").state).toBe("running");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("makes audio again that was being spoken when Misty closed", async () => {
    fakes.stored.tutor_guide = [
      { id: "overview-1", kind: "overview", audio: { state: "making" } },
      { id: "video-1", kind: "video", audio: { state: "making" } },
      { id: "overview-2", kind: "overview", audio: { state: "ready" } },
    ];
    await follow();
    expect(fakes.makeOverviewAudio).toHaveBeenCalledWith("overview-1");
    expect(fakes.makeVideoAudio).toHaveBeenCalledWith("video-1");
    expect(fakes.makeOverviewAudio).not.toHaveBeenCalledWith("overview-2");
  });
});

describe("a Teach me lesson", () => {
  it("opens as a teach-mode chat the person reads", async () => {
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
