import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const agents = vi.hoisted(() => ({ showAgentsPanel: vi.fn() }));
vi.mock("@/features/agents", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  showAgentsPanel: agents.showAgentsPanel,
  useMistyPanelStore: (select: (state: { open: boolean }) => unknown) => select({ open: false }),
}));

import { browserAgents } from "@/features/browser";
import { IconButton } from "@/shared/ui";
import { SidebarToolsRow } from "./SidebarToolsRow";

browserAgents.provide({
  AgentsButton: () => (
    <IconButton label="Agents" onClick={agents.showAgentsPanel}>
      A
    </IconButton>
  ),
  translatePageWithMisty: async () => undefined,
  useBrowserMistyAiAdapter: () => undefined,
  openBrowserAsk: async () => undefined,
});

it("opens the agents panel from the tools row on any page", () => {
  render(<SidebarToolsRow />);
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  expect(agents.showAgentsPanel).toHaveBeenCalledTimes(1);
});
