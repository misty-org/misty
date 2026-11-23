import { initializeHostAgentsRuntime } from "@/features/agents/host_agents_runtime";
import { vi } from "vitest";

vi.mock("@/features/agents/conversations/state/availability", () => ({
  assertMistyAvailable: vi.fn(async () => {}),
}));
vi.mock("@/features/agents/conversations/context/context_bridge", () => ({
  requestHostContext: vi.fn(async () => ({
    context: [],
  })),
}));
vi.mock("@/features/agents/personal/personal_agents_store", () => ({
  defaultAgentOf: (agents: { system_managed?: boolean; engine?: string }[]) =>
    agents.find((agent) => agent.engine) ?? agents.find((agent) => agent.system_managed),
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
