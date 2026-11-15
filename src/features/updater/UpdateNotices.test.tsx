import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoticeViewport } from "@/shared/ui";
import { UpdateNotices } from "./UpdateNotices";

const mocks = vi.hoisted(() => ({ check: vi.fn(), enabled: true, native: true, apps: vi.fn() }));
vi.mock("@/features/settings", () => ({
  settingsBoolean: () => mocks.enabled,
  useSettingsStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@/features/app-windows", () => ({ reserveMistyUpdate: () => () => {} }));
vi.mock("@/features/agents", () => ({
  MistyMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/shared/platform/relaunch", () => ({ relaunch: vi.fn() }));
// The menu bar's "Check for updates" reaches the window as an event.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: async () => () => {} }),
}));
beforeEach(() => {
  mocks.enabled = true;
  mocks.native = true;
  mocks.apps.mockClear();
  mocks.check.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

it("does not read the retired app catalog or respond to app update notices", async () => {
  render(<UpdateNotices accountScope="account" />);
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
  act(() =>
    window.dispatchEvent(
      new CustomEvent("misty:app-update-notice", { detail: "10 app updates available" }),
    ),
  );
  expect(mocks.apps).not.toHaveBeenCalled();
  expect(screen.queryByRole("complementary")).toBeNull();
});
it("asks to install a new Misty release, showing its notes", async () => {
  localStorage.clear();
  const close = vi.fn().mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({ version: "2.0.0", body: "Faster startup.", close });
  render(<UpdateNotices accountScope="account" />);
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Misty 2.0.0 is available");
  expect(dialog.textContent).toContain("Faster startup.");
  expect(screen.getByRole("button", { name: "Install and restart" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(close).toHaveBeenCalledTimes(1);
});
it("preserves unsaved-work notices independently of update checks", async () => {
  mocks.enabled = false;
  render(
    <>
      <NoticeViewport />
      <UpdateNotices accountScope="account" />
    </>,
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("misty:workspace-notice", {
        detail: "Save your changes before closing this tab.",
      }),
    ),
  );
  expect(screen.getByRole("status").textContent).toContain("Save your changes");
  expect(screen.queryByRole("button", { name: "View release" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(mocks.check).not.toHaveBeenCalled();
});
it("does not check without an account or outside the native app", () => {
  const view = render(<UpdateNotices accountScope="" />);
  expect(mocks.check).not.toHaveBeenCalled();
  mocks.native = false;
  view.rerender(<UpdateNotices accountScope="account" />);
  expect(mocks.check).not.toHaveBeenCalled();
});
