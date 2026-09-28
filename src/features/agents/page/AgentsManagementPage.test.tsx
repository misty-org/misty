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

vi.mock("../components/MistyDashboard", () => ({
  MistyDashboard: () => <section aria-label="Agent work">Independent task activity</section>,
}));

describe("Agents conversation page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presents a conversation composer beside the native agent roster", async () => {
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

    expect(container.textContent).toContain("Misty");
    expect(container.querySelector('[aria-label="Message Misty"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Your agents"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Definitions");
    expect(container.textContent).not.toContain("Edit Scout");
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("shows automations from the navigation route without a duplicate page switcher", async () => {
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
    expect(document.body.querySelector('[aria-label="Agent work"]')).not.toBeNull();
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
    expect(document.body.querySelector('[aria-label="Agent work"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Connect apps");
    expect(document.body.querySelector('[aria-label="Tool connections sheet"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
