import { vi } from "vitest";

// Shared by the native task authority and follow-up tests.
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
vi.mock("../../page/betaModes", () => ({ visibleAutopilotAvailable: () => mocks.autopilot }));
vi.mock("../jobs/workspaceAutopilot", () => ({ startWorkspaceAutopilot: mocks.startAutopilot }));
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
vi.mock("@/api/runtime/device-models", () => ({ deviceModelCall: mocks.deviceCall }));
vi.mock("../../artifacts/taskArtifacts", () => ({ trackTaskArtifacts: async () => {} }));
vi.mock("../../personal/useAgentsStore", () => ({ agentsDeviceSnapshot: mocks.deviceSnapshot }));
vi.mock("../../personal/useAgentDeviceStore", () => ({
  ensureAgentDevice: async () => ({ id: "server-device" }),
}));
vi.mock("@/features/agents/conversations/state/useMistyStore", () => ({
  useMistyStore: {
    getState: () => mocks.state,
    setState: (next: object) => Object.assign(mocks.state, next),
  },
}));
vi.mock("@/features/agents/conversations/state/mistyStoreUpdates", () => ({
  replaceActiveGlobalInvocationStream: mocks.stream,
}));
vi.mock("@/features/agents/runs/invocations/api", () => ({
  aiSurfaceApi: { cancelInvocation: mocks.cancel },
}));
export { mocks };
