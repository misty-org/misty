import "@/app/featureSeams";
import type * as AgentsRuntimeModule from "../AgentsRuntime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Agents opens straight into an agent's workspace, so the store needs one.
vi.mock("../personal/personalAgentsStore", () => ({
  usePersonalAgentsStore: () => ({
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
  }),
}));

vi.mock("../AgentsRuntime", async (original) => ({
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
