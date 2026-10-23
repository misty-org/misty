import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { vi } from "vitest";

// Shared by the Misty state tests: availability, host context and one default agent.
vi.mock("@/features/misty/availability", () => ({
  assertMistyAvailable: vi.fn(async () => {}),
}));
vi.mock("@/features/misty/contextBridge", () => ({
  requestHostContext: vi.fn(async () => ({
    context: [],
  })),
}));
vi.mock("@/features/agents/personalAgentsStore", () => ({
  usePersonalAgentsStore: {
    getState: () => ({
      accountId: "account-a",
      agents: [
        {
          id: "default-misty",
          system_managed: true,
          enabled: true,
        },
      ],
      load: async () => {},
    }),
  },
  selectedPersonalAgent: () => ({
    id: "default-misty",
    system_managed: true,
    enabled: true,
  }),
}));
initializeHostAgentsRuntime();
