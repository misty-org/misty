import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createDockLeaf, dockLeaves, insertDockSplit } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { WorkspacePaneControls } from "./WorkspacePaneControls";

afterEach(cleanup);
it("provides edge moves and a direct close action", () => {
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
  fireEvent.pointerDown(screen.getByRole("button", { name: "Arrange pane" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Push below" }));
  const root = useWorkspaceStore.getState().layout.root;
  expect(root.type).toBe("split");
  if (root.type !== "split") throw new Error("Expected split");
  expect(root.direction).toBe("vertical");
  expect(root.second.id).toBe(a.id);
  expect(dockLeaves(root)).toHaveLength(2);
});
it("does not offer close or rearrangement for the sole pane", () => {
  const pane = createDockLeaf();
  useWorkspaceStore.setState({ layout: { ...useWorkspaceStore.getState().layout, root: pane } });
  render(<WorkspacePaneControls pane={pane} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
});
