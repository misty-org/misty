import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createDockLeaf, dockLeaves, insertDockSplit } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { WorkspacePaneControls } from "./WorkspacePaneControls";

afterEach(cleanup);
it("provides a direct close action and a drag handle, with no arrange menu", () => {
  const a = createDockLeaf(),
    b = createDockLeaf();
  useWorkspaceStore.setState({
    layout: {
      ...useWorkspaceStore.getState().layout,
      root: insertDockSplit(a, a.id, b, "right"),
      focusedPaneId: a.id,
    },
  });
  const close = vi.fn();
  render(<WorkspacePaneControls pane={a} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Close pane" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Drag pane" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Arrange pane" })).toBeNull();
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
});
it("does not offer close or rearrangement for the sole pane", () => {
  const pane = createDockLeaf();
  useWorkspaceStore.setState({ layout: { ...useWorkspaceStore.getState().layout, root: pane } });
  render(<WorkspacePaneControls pane={pane} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
});
