import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DesktopAgentsPage from "../AgentsPage";

vi.mock("../components/PersonalAgentsSidebar", () => ({
  PersonalAgentsSidebar: () => <nav aria-label="Agent definitions">Definitions</nav>,
}));

vi.mock("../components/AgentEmptyState", () => ({
  AgentEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <section aria-label="Agent empty state">
      <h1>Build an agent for repeat work</h1>
      <button type="button" onClick={onCreate}>
        Blank agent
      </button>
    </section>
  ),
}));

describe("Agents conversation page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the empty state barebones without the old activity rails", async () => {
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

    expect(container.textContent).toContain("Build an agent for repeat work");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[aria-label="Agent definitions"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Agent empty state"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Spaces rail"]')).toBeNull();
    expect(container.textContent).not.toContain("Runtime steps");

    await act(async () => root.unmount());
  });
});
