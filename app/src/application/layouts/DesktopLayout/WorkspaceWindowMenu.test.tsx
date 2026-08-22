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
});
