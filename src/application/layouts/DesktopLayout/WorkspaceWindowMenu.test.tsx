import { createWorkspaceVirtualWindow } from "@/features/workspace/virtualWindows";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/features/webviews/browserRuntime", () => ({ setBrowserWebviewsSuspended: vi.fn() }));
import { useNavigationNames, windowNameKey } from "@/features/navigation-names/store";

describe("WorkspaceWindowMenu", () => {
  beforeEach(() => {
    const names: Record<string, string> = {};
    useNavigationNames.setState({
      account: "backend/account",
      names: {},
      ready: true,
      error: null,
    });
    native.invoke.mockReset();
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "navigation_names_update") {
        if (args.name === null) delete names[args.key];
        else names[args.key] = args.name;
      }
      return { names: { ...names }, error: null };
    });
  });
  afterEach(cleanup);

  it("lists, creates, closes, and reopens virtual windows", () => {
    const first = createWorkspaceVirtualWindow(undefined, "Writing");
    const second = createWorkspaceVirtualWindow(undefined, "Research");
    const onCreate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <>
        <WorkspaceWindowMenu
          windows={[first, second]}
          activeWindowId={first.id}
          canReopen
          onSelect={vi.fn()}
          onCreate={onCreate}
          onClose={onClose}
          onReopen={vi.fn()}
        />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Manage virtual windows" });
    expect(container.contains(trigger)).toBe(true);
    expect(container.querySelectorAll('[aria-label="Manage virtual windows"]')).toHaveLength(1);
    expect(trigger.querySelector(".lucide-chevron-down")).not.toBeNull();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("menuitem", { name: "Writing" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Research" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /New/ }));
    expect(onCreate).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Writing" }));
    expect(onClose).toHaveBeenCalledWith(first.id);
  });

  it("renames through the account-backed native store without selecting the window", async () => {
    const first = createWorkspaceVirtualWindow(undefined, "Window 1");
    const onSelect = vi.fn();
    const menu = (
      <WorkspaceWindowMenu
        windows={[first]}
        activeWindowId={first.id}
        canReopen={false}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        onReopen={vi.fn()}
      />
    );
    const view = render(menu);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.contextMenu(screen.getByRole("menuitem", { name: "Window 1" }), {
      button: 2,
      clientX: 30,
      clientY: 20,
    });
    fireEvent.click(await screen.findByText("Rename"));
    const input = await screen.findByRole("textbox", { name: "Rename Window 1" });
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(native.invoke).toHaveBeenCalledWith("navigation_names_update", {
      account: "backend/account",
      key: windowNameKey(first.id),
      name: "Research",
    });
    expect(onSelect).not.toHaveBeenCalled();
    view.unmount();
    render(menu);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Manage virtual windows" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("menuitem", { name: "Research" })).toBeTruthy();
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
