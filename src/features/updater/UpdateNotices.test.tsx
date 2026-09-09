import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { UpdateNotices } from "./UpdateNotices";

const state = vi.hoisted(() => ({
  catalog: [{ id: "journal", name: "Journal", version: "2.0.0", permission_version: 1 }],
  installations: [
    { app_id: "journal", state: "installed", installed_version: "1.0.0", permission_version: 1 },
  ],
}));
vi.mock("@/features/apps/useAppsStore", () => ({
  useAppsStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock("@/features/settings", () => ({
  settingsBoolean: () => false,
  useSettingsStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}
function setup() {
  return render(
    <MemoryRouter initialEntries={["/discover"]}>
      <UpdateNotices accountId="account" />
      <Location />
    </MemoryRouter>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  state.catalog = [{ id: "journal", name: "Journal", version: "2.0.0", permission_version: 1 }];
});
it("opens the specific app review and clears the notice", () => {
  setup();
  expect(screen.getByRole("status").textContent).toContain("Journal update available");
  fireEvent.click(screen.getByRole("button", { name: "Review update" }));
  expect(screen.getByTestId("location").textContent).toBe("/discover?app=journal");
  expect(screen.queryByRole("complementary", { name: "Update notification" })).toBeNull();
});
it("opens Installed for multiple updates and dismisses the notice", () => {
  state.catalog.push({
    id: "journal",
    name: "Journal second release",
    version: "3.0.0",
    permission_version: 1,
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "View updates" }));
  expect(screen.getByTestId("location").textContent).toBe("/discover?section=installed");
  expect(screen.queryByRole("complementary")).toBeNull();
});
it("dismisses without navigating, but shows a later release", () => {
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss update notification" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  state.catalog[0] = { ...state.catalog[0], version: "3.0.0" };
  view.rerender(
    <MemoryRouter>
      <UpdateNotices accountId="account" />
      <Location />
    </MemoryRouter>,
  );
  expect(screen.getByRole("complementary")).toBeTruthy();
});
