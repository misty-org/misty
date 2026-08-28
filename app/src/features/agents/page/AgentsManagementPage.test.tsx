import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DesktopAgentsPage from "../AgentsPage";

vi.mock("../mcp/McpConnectionsSheet", () => ({
  McpConnectionsSheet: ({ open }: { open: boolean }) =>
    open ? <aside aria-label="Tool connections sheet">Connections</aside> : null,
}));

vi.mock("../components/MistyWorkspace", () => ({
  MistyWorkspace: ({ onManageConnections }: { onManageConnections: () => void }) => (
    <section aria-label="Misty workspace">
      Misty
      <textarea aria-label="Message Misty" />
      <button type="button" onClick={onManageConnections}>
        Tool connections
      </button>
    </section>
  ),
}));

vi.mock("../automations/AutomationsWorkspace", () => ({
  AutomationsWorkspace: () => <section aria-label="Automations workspace">Automations</section>,
}));

describe("Agents conversation page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presents one Misty workspace with a natural composer", async () => {
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
    expect(container.querySelector('[aria-label="Misty workspace"]')).not.toBeNull();
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

    expect(container.querySelector('[aria-label="Automations workspace"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Misty workspace"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("keeps connection management available without per-Agent settings", async () => {
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

    const connectionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Tool connections"),
    );
    await act(async () => connectionButton?.click());
    expect(container.querySelector('[aria-label="Tool connections sheet"]')).not.toBeNull();

    await act(async () => root.unmount());
  });
});
