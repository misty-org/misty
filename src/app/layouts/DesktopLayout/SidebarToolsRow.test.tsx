import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const agents = vi.hoisted(() => ({ showAgentsPanel: vi.fn() }));
vi.mock("@/features/agents", () => ({
  showAgentsPanel: agents.showAgentsPanel,
  useMistyPanelStore: (select: (state: { open: boolean }) => unknown) => select({ open: false }),
}));

import { SidebarToolsRow } from "./SidebarToolsRow";

it("opens the agents panel from the tools row on any page", () => {
  render(<SidebarToolsRow />);
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  expect(agents.showAgentsPanel).toHaveBeenCalledTimes(1);
});
