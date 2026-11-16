import { afterEach, beforeEach, expect, vi } from "vitest";
import type { EngineRunResult } from "../engines/engineRun";
import type { TutorJob } from "./tutorTypes";

/**
 * The Lab's runs end to end in the window, shared by its run tests: a job runs on the default
 * engine with no chat behind it, and its finished answer is read into what Create shows. The
 * engine run is a stand-in each test finishes by hand.
 */

type Pending = { resolve(result: EngineRunResult): void; reject(error: Error): void };

const fakes = vi.hoisted(() => ({
  submitAnswer: vi.fn(),
  readRunState: vi.fn(),
  setMode: vi.fn(),
  makeOverviewAudio: vi.fn(),
  makeVideoAudio: vi.fn(),
  addLink: vi.fn(),
  runOnEngine: vi.fn(),
  followEngineRun: vi.fn(),
  stopEngineRun: vi.fn(),
  stored: {} as Record<string, unknown[]>,
  runs: new Map<string, unknown>(),
  started: 0,
  chats: 0,
  /** The default engine, or none. */
  engine: "claude" as string | undefined,
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
vi.mock("../engines/engineRun", () => ({
  noDefaultEngine: "Pick a default engine in Settings › Agents.",
  defaultEngineId: () =>
    fakes.engine
      ? Promise.resolve(fakes.engine)
      : Promise.reject(new Error("Pick a default engine in Settings › Agents.")),
  runOnEngine: fakes.runOnEngine,
  followEngineRun: fakes.followEngineRun,
  stopEngineRun: fakes.stopEngineRun,
}));
vi.mock("../engines/defaultEngine", () => ({
  defaultEngineAgent: (engine: string) => `personal_engine_${engine}`,
}));

const { useMistyStore } = await import("../conversations/state/useMistyStore");
const { useTutorStore } = await import("./tutorStore");
const { dismissJob, followTutorJobs, retryJob, startJob, startRun } = await import("./tutorRuns");
export { dismissJob, fakes, retryJob, startRun };

type ChatState = {
  accountId: string;
  conversations: unknown[];
  working: boolean;
  selectedAgentId?: string;
  activeConversationId?: string;
  invocationId?: string;
  invocationConversationId?: string;
};

export const chats = () => useMistyStore.getState() as unknown as ChatState;
export const setChats = (change: Partial<ChatState>) =>
  useMistyStore.setState(change as Record<string, unknown>);
export const tutor = () => useTutorStore.getState();
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A run waiting on its answer, by the run's id. */
const pending = (runId: string) => {
  let held!: Pending;
  const promise = new Promise<EngineRunResult>((resolve, reject) => {
    held = { resolve, reject };
  });
  fakes.runs.set(runId, held);
  return promise;
};

/** The engine finishes `runId` with this answer, or this error; what it makes is read in. */
export async function finish(runId: string, text: string, error?: string) {
  const run = fakes.runs.get(runId) as Pending | undefined;
  if (!run) throw new Error(`No run ${runId}`);
  run.resolve({ runId, text, ...(error ? { error } : {}) });
  await flush();
}

/** The run a job is on now. */
export const runOf = (jobId: string) => tutor().jobs[jobId]?.runId ?? "";

export const jobOf = (id: string) => tutor().jobs[id];

let stop: (() => void) | undefined;

export async function follow() {
  stop = followTutorJobs("acct");
  await vi.waitFor(() => expect(tutor().ready).toBe(true));
  await flush();
}

export function job(input: Partial<TutorJob> & Pick<TutorJob, "kind">) {
  return startJob({
    title: "Topic: Volcanoes",
    notebookId: "n1",
    prompt: "Make it",
    ...input,
  });
}

/** The chat turn `submitAnswer` starts, for `startRun` (a pick-up's draft). */
function startTurn(_prompt: string, ...rest: unknown[]) {
  const { conversationId } = rest[3] as { conversationId: string };
  setChats({
    working: true,
    invocationId: `inv-${conversationId}`,
    invocationConversationId: conversationId,
    activeConversationId: conversationId,
  });
  return Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.stored = {};
  fakes.runs.clear();
  fakes.started = 0;
  fakes.engine = "claude";
  fakes.runOnEngine.mockImplementation((input: { onStarted?(runId: string): void }) => {
    const runId = `run-${++fakes.started}`;
    input.onStarted?.(runId);
    return pending(runId);
  });
  fakes.followEngineRun.mockImplementation((runId: string) => pending(runId));
  fakes.stopEngineRun.mockResolvedValue(undefined);
  fakes.submitAnswer.mockImplementation(startTurn);
  fakes.setMode.mockResolvedValue(undefined);
  fakes.readRunState.mockResolvedValue("missing");
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
      conversations: [],
      working: false,
      selectedAgentId: "agent-mine",
      activeConversationId: "chat-elsewhere",
      invocationId: undefined,
      invocationConversationId: undefined,
      submitAnswer: fakes.submitAnswer,
    } as unknown as ReturnType<typeof useMistyStore.getState>,
    true,
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
});
