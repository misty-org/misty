import { registerPreferenceWriter } from "@/features/settings/device-preferences/bridge";
import {
  editPreference,
  initialPreferencesState,
} from "@/features/settings/device-preferences/setting_resolution";
import { useDevicePreferences } from "@/features/settings/device-preferences/store";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { CursorCompanionController } from "./CursorCompanionController";
import type { CompanionConversation } from "./companion_conversation";
import type * as TutorConversationModule from "./tutor_conversation";
import type * as MistyUi from "@misty/ui";
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  transcribe: vi.fn(),
  speech: vi.fn(),
  voiceAppend: vi.fn(),
  conversationOpen: vi.fn(),
  conversationBegin: vi.fn(),
  conversationCommit: vi.fn(),
  conversationInterrupt: vi.fn(),
  conversationClose: vi.fn(),
  conversationOptions: undefined as
    undefined | ConstructorParameters<typeof CompanionConversation>[0],
  cancel: vi.fn(),
  pause: vi.fn(),
  taskId: "desktop-task",
  submit: vi.fn(),
  steer: vi.fn(),
  conversationReady: Promise.resolve() as Promise<unknown>,
  agent: { id: "ada", name: "Ada", engine: "claude", avatar: {} },
  openThread: vi.fn(),
  loadConversations: vi.fn(async () => {}),
  state: {
    accountId: "account",
    activeConversationId: "conversation",
    selectedAgentId: undefined as string | undefined,
    executionMode: "user" as "user" | "agent",
    working: false,
    error: null as string | null,
    invocationId: undefined as string | undefined,
    invocationConversationId: undefined as string | undefined,
    conversations: [] as unknown[],
  },
  subscribers: new Set<() => void>(),
}));
vi.mock("../../runs/local-execution/local_execution_state", () => ({
  useLocalExecution: { getState: () => ({ execution: { taskId: mocks.taskId } }) },
  pauseLocalExecution: mocks.pause,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
      mocks.listeners.set(name, cb);
      return () => {
        if (mocks.listeners.get(name) === cb) mocks.listeners.delete(name);
      };
    },
  }),
}));
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
vi.mock("@misty/ui", async (original) => ({
  ...(await original<typeof MistyUi>()),
  notify: vi.fn(),
}));
vi.mock("./tutor_conversation", async (original) => ({
  ...(await original<typeof TutorConversationModule>()),
  tutorConversation: async () => "conversation",
}));
vi.mock("./tutor_handoff", () => ({
  handoffAgents: () => [mocks.agent],
  agentNamed: (name?: string) =>
    name && mocks.agent.name.toLowerCase().startsWith(name.toLowerCase()) ? mocks.agent : undefined,
  pickAgent: () => mocks.agent,
  workingAgent: () => undefined,
  agentThreadId: () => "conversation",
  NoAgentError: class extends Error {},
  openAgentThread: mocks.openThread,
  handOff: async (input: {
    instruction: string;
    key: string;
    turn: number;
    interactionMode: string;
    screens: unknown[];
  }) => {
    await mocks.submit(
      input.instruction,
      [],
      undefined,
      [],
      { conversationId: "conversation", context: [] },
      {
        turn: input.turn,
        executionMode: "user",
        interactionMode: input.interactionMode,
        idempotencyKey: input.key,
        ...(input.screens.length ? { displayCaptures: input.screens } : {}),
      },
    );
    if (mocks.state.error) throw new Error(mocks.state.error);
    return { invocationId: mocks.state.invocationId ?? "", conversationId: "conversation" };
  },
}));
vi.mock("./companion_conversation", () => ({
  CompanionConversation: class {
    constructor(private options: ConstructorParameters<typeof CompanionConversation>[0]) {
      mocks.conversationOpen();
      mocks.conversationOptions = options;
      mocks.conversationReady = options.conversation().catch(() => undefined);
    }
    begin = mocks.conversationBegin;
    append = mocks.voiceAppend;
    commit = mocks.conversationCommit;
    submitText = mocks.conversationCommit;
    async readResult(id: string) {
      await mocks.speech(id);
      this.options.onPlaying();
      await new Promise<void>(() => {});
    }
    interrupt = mocks.conversationInterrupt;
    close = mocks.conversationClose;
  },
}));
vi.mock("@/features/agents/conversations/state/use_misty_store", () => ({
  useMistyStore: {
    setState: (update: (state: typeof mocks.state) => Partial<typeof mocks.state>) =>
      Object.assign(mocks.state, update(mocks.state)),
    getState: () => ({
      ...mocks.state,
      setAccount: (accountId: string) => {
        mocks.state.accountId = accountId;
      },
      cancelResponse: mocks.cancel,
      submitAnswer: mocks.submit,
      steerResponse: mocks.steer,
      loadConversations: mocks.loadConversations,
    }),
    subscribe: (cb: () => void) => {
      mocks.subscribers.add(cb);
      return () => mocks.subscribers.delete(cb);
    },
  },
}));
const emit = (event: string, payload: unknown) =>
  act(() => {
    mocks.listeners.get(`misty://cursor-${event}`)?.({
      payload,
    });
  });
const opened = () =>
  act(async () => {
    await mocks.conversationReady;
  });
const presentations = () =>
  mocks.invoke.mock.calls
    .filter(([name]) => name === "cursor_companion_present")
    .map(([, args]) => args.presentation);
function saveCompanion(companion: Record<string, unknown>) {
  useDevicePreferences.setState({ state: initialPreferencesState({ companion }) });
}
async function mounted() {
  const result = render(<CursorCompanionController accountId="account" />);
  await waitFor(() => expect(presentations().length).toBeGreaterThan(0));
  return result;
}
beforeEach(() => {
  useDevicePreferences.setState({
    state: initialPreferencesState({}),
    ready: true,
  });
  registerPreferenceWriter(async (id, value) => {
    useDevicePreferences.setState(({ state }) => ({
      state: editPreference(state!, id, value),
    }));
  });
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.subscribers.clear();
  localStorage.clear();
  mocks.taskId = "desktop-task";
  mocks.pause.mockResolvedValue(undefined);
  mocks.state.accountId = "account";
  mocks.state.activeConversationId = "conversation";
  mocks.state.selectedAgentId = undefined;
  mocks.steer.mockResolvedValue(undefined);
  mocks.state.executionMode = "user";
  mocks.state.working = false;
  mocks.state.error = null;
  mocks.state.invocationId = undefined;
  mocks.state.conversations = [{ id: "conversation", messages: [] }];
  mocks.state.invocationConversationId = undefined;
  mocks.conversationCommit.mockReset().mockResolvedValue(undefined);
  mocks.conversationInterrupt.mockResolvedValue(undefined);
  mocks.conversationOptions = undefined;
  mocks.conversationReady = Promise.resolve();
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  mocks.invoke.mockImplementation(
    async (
      name: string,
      args: {
        expectedTurn?: number;
      },
    ) =>
      name === "cursor_companion_configure"
        ? 1
        : name === "cursor_companion_interrupt"
          ? (args.expectedTurn ?? 1) + 1
          : name === "cursor_companion_capture"
            ? []
            : undefined,
  );
  mocks.submit.mockReset();
  mocks.cancel.mockResolvedValue(undefined);
  mocks.transcribe.mockResolvedValue({
    transcript: "What is this?",
  });
  mocks.speech.mockResolvedValue(new Blob(["audio"]));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

export { emit, mocks, mounted, opened, presentations, saveCompanion };
