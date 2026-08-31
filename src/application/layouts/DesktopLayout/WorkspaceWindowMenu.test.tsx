import { createWorkspaceVirtualWindow } from "@/features/workspace/virtualWindows";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";

describe("WorkspaceWindowMenu", () => {
  afterEach(cleanup);

  it("lists, creates, closes, and reopens virtual windows", () => {
    const first = createWorkspaceVirtualWindow(undefined, "Writing");
    const second = createWorkspaceVirtualWindow(undefined, "Research");
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceWindowMenu
        windows={[first, second]}
        activeWindowId={first.id}
        canReopen
        onSelect={vi.fn()}
        onCreate={onCreate}
        onClose={onClose}
        onReopen={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("menuitem", { name: "1Writing" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "2Research" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /New/ }));
    expect(onCreate).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Writing" }));
    expect(onClose).toHaveBeenCalledWith(first.id);
  });

  it("hides a window close icon when that window is protected", () => {
    const first = createWorkspaceVirtualWindow(undefined, "Home window");
    const second = createWorkspaceVirtualWindow(undefined, "Research");
    render(
      <WorkspaceWindowMenu
        windows={[first, second]}
        activeWindowId={first.id}
        canReopen={false}
        canCloseWindow={(workspaceWindow) => workspaceWindow.id !== first.id}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByRole("button", { name: "Close Home window" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close Research" })).toBeTruthy();
  });
});
