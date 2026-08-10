import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopAgentsPage from "../../AgentsPage";

vi.mock("../../components/PersonalAgentsSidebar", () => ({
  PersonalAgentsSidebar: () => <nav aria-label="Agent definitions">Definitions</nav>,
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

    expect(container.textContent).toContain("Manage your Agents");
    expect(container.textContent).toContain("Conversations with Agents happen inside each Space");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[aria-label="Agent definitions"]')).not.toBeNull();

    await act(async () => root.unmount());
  });
});
