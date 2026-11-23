import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  autopilot: false,
  account: "owner",
  sessionGeneration: 0,
  transitioning: false,
  startAutopilot: vi.fn(),
  focus: vi.fn(),
  request: vi.fn(),
  deviceCall: vi.fn(),
  cancel: vi.fn(),
  stream: vi.fn(),
  state: {
    working: false,
    invocationId: undefined as string | undefined,
    activeConversationId: "conversation",
    accountId: "owner",
    selectedSpaceId: "space",
    submitAnswer: vi.fn(),
  },
  deviceSnapshot: vi.fn(),
}));
vi.mock("../../page/beta_modes", () => ({ visibleAutopilotAvailable: () => mocks.autopilot }));
vi.mock("../jobs/workspace_autopilot", () => ({ startWorkspaceAutopilot: mocks.startAutopilot }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "space-personal", setFocus: mocks.focus }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/account/core", () => ({
  useUserStore: { getState: () => ({ me: { id: mocks.account } }) },
}));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => mocks.sessionGeneration,
  isApiSessionTransitioning: () => mocks.transitioning,
}));
vi.mock("@/api/client", () => ({
  apiRequest: mocks.request,
  resolveRequiredApiBase: async () => "https://api.example.test",
}));
vi.mock("../../engines/misty_calls", () => ({
  followUpOnEngine: (body: unknown) => mocks.deviceCall("follow-up", body),
}));
vi.mock("../../artifacts/task_artifacts", () => ({ trackTaskArtifacts: async () => {} }));
vi.mock("../../personal/use_agents_store", () => ({ agentsDeviceSnapshot: mocks.deviceSnapshot }));
vi.mock("../../personal/use_agent_device_store", () => ({
  ensureAgentDevice: async () => ({ id: "server-device" }),
}));
vi.mock("@/features/agents/conversations/state/use_misty_store", () => ({
  useMistyStore: {
    getState: () => mocks.state,
    setState: (next: object) => Object.assign(mocks.state, next),
  },
}));
vi.mock("@/features/agents/conversations/state/misty_store_updates", () => ({
  replaceActiveGlobalInvocationStream: mocks.stream,
}));
vi.mock("@/features/agents/runs/invocations/api", () => ({
  aiSurfaceApi: { cancelInvocation: mocks.cancel },
}));
export { mocks };
