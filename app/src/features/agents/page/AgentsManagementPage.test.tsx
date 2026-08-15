import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../components/AgentSpacesRail", () => ({
  AgentSpacesRail: () => <aside aria-label="Spaces rail">Spaces</aside>,
}));

describe("Agents management page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("manages reusable identities without rendering a chat composer", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<DesktopAgentsPage />));

    expect(container.textContent).toContain("Build an agent for repeat work");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[aria-label="Agent definitions"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Agent empty state"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Spaces rail"]')).not.toBeNull();

    await act(async () => root.unmount());
  });
});
