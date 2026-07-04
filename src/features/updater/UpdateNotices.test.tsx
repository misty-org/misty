import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateNotices } from "./UpdateNotices";

const mocks = vi.hoisted(() => ({ check: vi.fn(), enabled: true, native: true, apps: vi.fn() }));
vi.mock("@/features/settings", () => ({
  settingsBoolean: () => mocks.enabled,
  useSettingsStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
beforeEach(() => {
  mocks.enabled = true;
  mocks.native = true;
  mocks.apps.mockClear();
  mocks.check.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

it("does not read the retired app catalog or respond to app update notices", async () => {
  render(<UpdateNotices accountId="account" />);
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
  act(() =>
    window.dispatchEvent(
      new CustomEvent("misty:app-update-notice", { detail: "10 app updates available" }),
    ),
  );
  expect(mocks.apps).not.toHaveBeenCalled();
  expect(screen.queryByRole("complementary")).toBeNull();
});
it("still checks for Misty releases and opens update settings", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({ version: "2.0.0", close });
  const openSettings = vi.fn();
  window.addEventListener("misty:open-settings", openSettings);
  try {
    render(<UpdateNotices accountId="account" />);
    expect((await screen.findByRole("status")).textContent).toContain("Misty 2.0.0 is available");
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View release" }));
    expect(openSettings).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { section: "updates" } }),
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  } finally {
    window.removeEventListener("misty:open-settings", openSettings);
  }
});
it("preserves unsaved-work notices independently of update checks", () => {
  mocks.enabled = false;
  render(<UpdateNotices accountId="account" />);
  act(() =>
    window.dispatchEvent(
      new CustomEvent("misty:workspace-notice", {
        detail: "Save your changes before closing this tab.",
      }),
    ),
  );
  expect(screen.getByRole("status").textContent).toContain("Save your changes");
  expect(screen.queryByRole("button", { name: "View release" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss update notification" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(mocks.check).not.toHaveBeenCalled();
});
it("does not check without an account or outside the native app", () => {
  const view = render(<UpdateNotices accountId="" />);
  expect(mocks.check).not.toHaveBeenCalled();
  mocks.native = false;
  view.rerender(<UpdateNotices accountId="account" />);
  expect(mocks.check).not.toHaveBeenCalled();
});
