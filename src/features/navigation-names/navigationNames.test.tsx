import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Renameable } from "./Renameable";
import {
  navigationName,
  refreshNavigationNames,
  setNavigationName,
  useNavigationName,
  useNavigationNames,
  validateNavigationName,
} from "./store";
const native = vi.hoisted(() => ({ invoke: vi.fn(), overlay: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/features/browser/browserRuntime", async (original) => ({
  ...(await original<typeof import("@/features/browser/browserRuntime")>()),
  setBrowserWebviewsSuspended: native.overlay,
}));
let disk: Record<string, Record<string, string>>;
beforeEach(() => {
  disk = {};
  native.invoke.mockReset();
  native.overlay.mockReset();
  useNavigationNames.setState({ account: "backend/account", names: {}, ready: true, error: null });
  native.invoke.mockImplementation(async (command, args) => {
    const names = (disk[args.account] ??= {});
    if (command === "navigation_names_update") {
      if (args.name === null) delete names[args.key];
      else names[args.key] = args.name;
    }
    return { names: { ...names }, error: null };
  });
});
afterEach(cleanup);
function Label({ automatic = "Messages · Instagram" }: { automatic?: string }) {
  const label = useNavigationName("tab:one", automatic);
  return (
    <Renameable nameKey="tab:one" automatic={automatic}>
      <button>{label}</button>
    </Renameable>
  );
}
it("keeps aliases above automatic updates and Reset exposes the latest title without crossing account scopes", async () => {
  await setNavigationName("tab:one", "  Personal  ");
  expect(navigationName("tab:one", "Inbox")).toBe("Personal");
  expect(navigationName("tab:new", "Inbox")).toBe("Inbox");
  await setNavigationName("tab:one", null);
  expect(navigationName("tab:one", "Latest message")).toBe("Latest message");
  useNavigationNames.setState({ account: "other-backend/account", names: {} });
  await refreshNavigationNames("other-backend/account");
  expect(navigationName("tab:one", "Inbox")).toBe("Inbox");
});
it("selects inline text, cancels with Escape, commits with Enter, resets and restores focus", async () => {
  const ui = render(<Label />);
  fireEvent.contextMenu(screen.getByRole("button"), { button: 2, clientX: 30, clientY: 20 });
  fireEvent.click(await screen.findByText("Rename"));
  let input = (await screen.findByRole("textbox")) as HTMLInputElement;
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
  fireEvent.change(input, { target: { value: "Canceled" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByRole("button"), { button: 2 });
  fireEvent.click(await screen.findByText("Rename"));
  input = (await screen.findByRole("textbox")) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Personal" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(screen.getByRole("button").textContent).toBe("Personal");
  expect(document.activeElement).toBe(screen.getByRole("button"));
  ui.rerender(<Label automatic="Inbox · Instagram" />);
  expect(screen.getByRole("button").textContent).toBe("Personal");
  fireEvent.contextMenu(screen.getByRole("button"), { button: 2 });
  fireEvent.click(await screen.findByText("Reset"));
  await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Inbox · Instagram"));
  expect(native.overlay).toHaveBeenCalledWith(true, "rename:tab:one");
});
it("keeps the editor open when a save fails and accepts blur commits", async () => {
  render(<Label />);
  fireEvent.contextMenu(screen.getByRole("button"), { button: 2 });
  fireEvent.click(await screen.findByText("Rename"));
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "School" } });
  native.invoke.mockRejectedValueOnce(new Error("Read-only config"));
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Read-only config"));
  expect(screen.getByRole("textbox")).toBe(input);
  fireEvent.blur(input);
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(screen.getByRole("button").textContent).toBe("School");
});
it("validates names without changing meaningful numbers", () => {
  expect(validateNavigationName("  Project 2026  ")).toBe("Project 2026");
  for (const name of ["", "a\nb", "a".repeat(121)])
    expect(() => validateNavigationName(name)).toThrow();
});

it("renames an individual tab from its group dropdown", async () => {
  const { WorkspaceTabGroupButton } =
    await import("@/application/layouts/DesktopLayout/WorkspaceTabGroupButton");
  const { Inbox } = await import("lucide-react");
  const tab = {
    id: "one",
    groupInstanceId: "group-one",
    surfaceId: "browser" as const,
    groupKey: "tool:browser" as const,
    instanceKey: "one",
    title: "Inbox · Gmail",
    route: "/browser",
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
  };
  render(
    <WorkspaceTabGroupButton
      group={{
        key: tab.groupKey,
        surfaceId: tab.surfaceId,
        label: "Browser",
        tabs: [tab],
        storeGroupKey: tab.groupKey,
      }}
      icon={Inbox}
      activeTabId={tab.id}
      canClose
      lastUsedTabByGroup={{}}
      onOpen={() => {}}
      onClose={() => {}}
      onMoveTab={() => {}}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Show Browser tabs" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const row = await screen.findByRole("menuitem", { name: /Inbox · Gmail/ });
  fireEvent.contextMenu(row, { button: 2 });
  fireEvent.click(await screen.findByText("Rename"));
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "My mailbox" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(useNavigationNames.getState().names["tab:one"]).toBe("My mailbox"));
  expect(useNavigationNames.getState().names["group:group-one"]).toBeUndefined();
});
