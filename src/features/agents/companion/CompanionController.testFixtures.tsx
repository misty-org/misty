import { registerProfileWriter } from "@/features/settings/profiles/bridge";
import { editPreference, initialProfileState } from "@/features/settings/profiles/model";
import { useSettingsProfiles } from "@/features/settings/profiles/store";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { CursorCompanionController } from "./CursorCompanionController";
import type { CompanionConversation } from "./companionConversation";
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  transcribe: vi.fn(),
  speech: vi.fn(),
  voiceClose: vi.fn(),
  voiceOpen: vi.fn(),
  voiceAppend: vi.fn(),
  voiceError: undefined as undefined | ((error: Error) => void),
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
  loadConversations: vi.fn(async () => {}),
  state: {
    accountId: "account",
    activeConversationId: "conversation",
    selectedAgentId: undefined as string | undefined,
    executionMode: "user" as "user" | "agent" | "team",
    working: false,
    error: null as string | null,
    invocationId: undefined as string | undefined,
    invocationConversationId: undefined as string | undefined,
    conversations: [] as unknown[],
  },
  subscribers: new Set<() => void>(),
}));
vi.mock("../localExecution", () => ({
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
vi.mock("./companionVoice", () => ({
  CompanionVoice: class {
    private finish?: () => void;
    constructor(
      private options: {
        signal: AbortSignal;
        onPlaying: () => void;
        onError: (error: Error) => void;
      },
    ) {
      mocks.voiceOpen();
      mocks.voiceError = options.onError;
    }
    append = mocks.voiceAppend;
    async commit() {
      const value = await mocks.transcribe(undefined, undefined, this.options.signal);
      return value.transcript;
    }
    async speak(id: string) {
      await mocks.speech(id, this.options.signal);
      if (this.options.signal.aborted) return;
      this.options.onPlaying();
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    }
    close() {
      mocks.voiceClose();
      this.finish?.();
    }
  },
}));
vi.mock("./companionConversation", () => ({
  CompanionConversation: class {
    constructor(private options: ConstructorParameters<typeof CompanionConversation>[0]) {
      mocks.conversationOpen();
      mocks.conversationOptions = options;
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
vi.mock("@/api/assistant/api", () => ({
  assistantApi: {
    frontierModels: async () => ({
      models: [],
    }),
  },
}));
vi.mock("@/features/misty/useMistyStore", () => ({
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
const presentations = () =>
  mocks.invoke.mock.calls
    .filter(([name]) => name === "cursor_companion_present")
    .map(([, args]) => args.presentation);
async function mounted() {
  const legacy = JSON.parse(localStorage.getItem("misty.cursor-companion:account") || "null");
  if (legacy) {
    useSettingsProfiles.setState({ state: initialProfileState({ companion: legacy }) });
    localStorage.removeItem("misty.cursor-companion:account");
  }
  const result = render(<CursorCompanionController accountId="account" />);
  await waitFor(() => expect(presentations().length).toBeGreaterThan(0));
  return result;
}
beforeEach(() => {
  useSettingsProfiles.setState({
    accountId: "account",
    state: initialProfileState({}),
    ready: true,
  });
  registerProfileWriter(async (id, value) => {
    useSettingsProfiles.setState(({ state }) => ({
      state: editPreference(state!, id, value, crypto.randomUUID()),
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

export { emit, mocks, mounted, presentations };
