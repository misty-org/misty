import "@/app/feature_seams";
import type * as AgentsRuntimeModule from "../agents_runtime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const personalAgents = vi.hoisted(() => ({
  agents: [
    {
      id: "misty",
      name: "Misty",
      role: "",
      instructions: "",
      avatar: {},
      model_mode: "automatic",
      model_id: "",
      enabled: true,
      system_managed: true,
    },
  ],
  loading: false,
  error: "",
  load: async () => {},
}));

vi.mock("../personal/personal_agents_store", () => ({
  defaultAgentOf: (agents: { system_managed?: boolean; engine?: string }[]) =>
    agents.find((agent) => agent.engine) ?? agents.find((agent) => agent.system_managed),
  usePersonalAgentsStore: Object.assign(() => personalAgents, { getState: () => personalAgents }),
}));

vi.mock("../agents_runtime", async (original) => ({
  ...(await original<typeof AgentsRuntimeModule>()),
  useAgentsAuth: () => ({ user: { id: "owner" } }),
  runtimeAiApi: { activity: async () => ({ entries: [] }) },
}));

import AgentsPage from "./AgentsPage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function agentsSurface(entry: string) {
  return (
    <MemoryRouter key={entry} initialEntries={[entry]}>
      <AgentsPage />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe("Agents automation route state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the chat for old automation links and leaves the link as it was", async () => {
    await act(async () => root.render(agentsSurface("/agents?view=automations&automation=flow-1")));
    expect(container.querySelector(".agent-studio")?.getAttribute("data-page")).toBe("task");
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/agents?view=automations&automation=flow-1",
    );
  });
});
