import { afterEach, beforeEach, expect, vi } from "vitest";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import type { TutorJob } from "./tutorTypes";

/**
 * Tutor's runs end to end in the window, shared by its run tests: a job starts a hidden chat turn
 * on the person's agent, waits its turn, and its finished reply is read into what Create shows.
 * The chat store is a small stand-in whose `submitAnswer` starts a turn the way the real one
 * reports it.
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
export { dismissJob, fakes, retryJob, startRun };

export type Chat = Pick<GlobalAiConversation, "id" | "title" | "messages">;
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

export const chats = () => useMistyStore.getState() as unknown as ChatState;
export const setChats = (change: Partial<ChatState>) =>
  useMistyStore.setState(change as Record<string, unknown>);
export const tutor = () => useTutorStore.getState();
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A chat that is already there, so the window counts as loaded. */
export const elsewhere: Chat = { id: "chat-elsewhere", title: "Something else", messages: [] };

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
export function finish(
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
    } as unknown as ReturnType<typeof useMistyStore.getState>,
    true,
  );
});

afterEach(() => {
  stop?.();
  stop = undefined;
});
