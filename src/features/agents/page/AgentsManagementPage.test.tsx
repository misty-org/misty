import type * as AgentsRuntimeModule from "../AgentsRuntime";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DesktopAgentsPage from "../AgentsPage";

vi.mock("../mcp/McpConnectionsSheet", () => ({
  McpConnectionsSheet: ({ open }: { open: boolean }) =>
    open ? <aside aria-label="Tool connections sheet">Connections</aside> : null,
  McpConnectionsView: () => <aside aria-label="Tool connections sheet">Connections</aside>,
}));

// Agents opens straight into an agent's workspace, so the store needs one.
vi.mock("../personalAgentsStore", () => ({
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

describe("Agents conversation page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens straight into the New task conversation without a directory", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <DesktopAgentsPage />
        </MemoryRouter>,
      ),
    );

    const headings = [...container.querySelectorAll("h1")].map((h) => h.textContent);
    expect(headings).toContain("What can I do for you?");
    expect(headings).not.toContain("Agents");
    expect(container.querySelector('[aria-label="Search all"]')).toBeNull();
    expect(container.querySelector('[aria-label="Agent workspace pages"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Browse all agents");
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("opens Workflows for retired automation links without a duplicate page switcher", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/agents?view=automations"]}>
          <DesktopAgentsPage />
        </MemoryRouter>,
      ),
    );

    expect(container.querySelector('[aria-label="Automations workspace"]')).toBeNull();
    const pages = container.querySelector('[aria-label="Agent workspace pages"]');
    expect(pages?.querySelector('[aria-current="page"]')?.textContent).toBe("Workflows");
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("omits connection management from the agent navigation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/agents?view=activity"]}>
          <DesktopAgentsPage />
        </MemoryRouter>,
      ),
    );
    const pages = container.querySelector('[aria-label="Agent workspace pages"]');
    expect(pages?.textContent).not.toContain("Connect");
    expect(document.body.querySelector('[aria-label="Tool connections sheet"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
