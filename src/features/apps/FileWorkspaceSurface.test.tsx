import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type { WorkspaceTab } from "@/features/workspace/model";
import { FileWorkspaceSurface } from "./FileWorkspaceSurface";
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/features/files/explorer", () => ({
  default: function MockExplorer({ active }: { active: boolean }) {
    useEffect(() => {
      mount();
    }, []);
    return <div data-active={String(active)}>Original Explorer</div>;
  },
}));
vi.mock("@/features/transfers/TransfersPage", () => ({
  TransfersWorkspacePanel: () => <div>Native Transfers history</div>,
}));
afterEach(cleanup);
it("preserves Explorer state while Transfers is shown and disables hidden Explorer shortcuts", async () => {
  const tab = { id: "files", route: "/apps/files" } as WorkspaceTab;
  const ui = render(
    <MemoryRouter>
      <FileWorkspaceSurface tab={tab} options={{ view: "explorer" }} />
    </MemoryRouter>,
  );
  expect((await screen.findByText("Original Explorer")).getAttribute("data-active")).toBe("true");
  ui.rerender(
    <MemoryRouter>
      <FileWorkspaceSurface tab={tab} options={{ view: "transfers" }} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Native Transfers history")).not.toBeNull();
  expect(screen.getByText("Original Explorer").getAttribute("data-active")).toBe("false");
  ui.rerender(
    <MemoryRouter>
      <FileWorkspaceSurface tab={tab} options={{ view: "explorer" }} />
    </MemoryRouter>,
  );
  expect(screen.queryByText("Native Transfers history")).toBeNull();
  expect(mount).toHaveBeenCalledTimes(1);
});
