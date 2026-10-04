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
  normalContext: vi.fn(),
}));
vi.mock("./companion/normalTabs", () => ({ companionBrowserContext: mocks.normalContext }));
vi.mock("./betaModes", () => ({ visibleAutopilotAvailable: () => mocks.autopilot }));
vi.mock("./workspaceAutopilot", () => ({ startWorkspaceAutopilot: mocks.startAutopilot }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", setFocus: mocks.focus }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/auth/core", () => ({
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
vi.mock("./taskArtifacts", () => ({ trackTaskArtifacts: async () => {} }));
vi.mock("./store/useAgentsStore", () => ({ agentsDeviceSnapshot: mocks.deviceSnapshot }));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server-device" }),
}));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: {
    getState: () => mocks.state,
    setState: (next: object) => Object.assign(mocks.state, next),
  },
}));
vi.mock("@/features/global-search/globalSearchStoreHelpers", () => ({
  replaceActiveGlobalInvocationStream: mocks.stream,
}));
vi.mock("@/features/ai-surface/api", () => ({ aiSurfaceApi: { cancelInvocation: mocks.cancel } }));
export { mocks };
