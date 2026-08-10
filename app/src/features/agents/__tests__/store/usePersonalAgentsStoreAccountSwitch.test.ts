import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalAgent } from "../../model/interfaces/personal";

const apiMocks = vi.hoisted(() => ({
  spaceRequest: vi.fn(),
}));

vi.mock("@/services/spaces/api", () => ({
  spaceRequest: apiMocks.spaceRequest,
}));

import {
  resetPersonalAgentsAccountState,
  usePersonalAgentsStore,
} from "../../store/usePersonalAgentsStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const accountAAgent = {
  id: "agent-a",
  owner_user_id: "account-a",
  name: "Account A Agent",
  role: "Planner",
  description: "Private to account A",
  icon: "bot",
  avatar: { kind: "preset", preset_id: "bot", accent: "indigo" },
  instructions: "",
  model_mode: "pinned",
  model_id: "openai/gpt-5-mini",
  reasoning_effort: "medium",
  context_permissions: {},
  tool_permissions: {},
  enabled: true,
  version: 1,
  created_at: "2026-08-03T00:00:00Z",
  updated_at: "2026-08-03T00:00:00Z",
} as PersonalAgent;

describe("personal Agent catalog account isolation", () => {
  beforeEach(() => {
    apiMocks.spaceRequest.mockReset();
    resetPersonalAgentsAccountState();
  });

  it("clears the prior account immediately", () => {
    usePersonalAgentsStore.setState({ agents: [accountAAgent], loaded: true });
    resetPersonalAgentsAccountState();
    expect(usePersonalAgentsStore.getState().agents).toEqual([]);
    expect(usePersonalAgentsStore.getState().loaded).toBe(false);
  });

  it("discards a catalog response that resolves after an account switch", async () => {
    const agents = deferred<{ agents: PersonalAgent[] }>();
    const models = deferred<{ catalog_version: string; models: [] }>();
    apiMocks.spaceRequest.mockImplementation((path: string) =>
      path === "/agents" ? agents.promise : models.promise,
    );

    const staleLoad = usePersonalAgentsStore.getState().load();
    resetPersonalAgentsAccountState();
    agents.resolve({ agents: [accountAAgent] });
    models.resolve({ catalog_version: "test", models: [] });
    await staleLoad;

    expect(usePersonalAgentsStore.getState().agents).toEqual([]);
    expect(usePersonalAgentsStore.getState().loaded).toBe(false);
  });
});
