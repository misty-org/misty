import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { homeApi } from "@/api/home/api";
import { useSpacesStore } from "@/features/spaces";
import { HomeDashboard } from "./HomeDashboard";
import { cacheHomeActivity, contributionDates, dateKey, readHomeActivity } from "./homeActivity";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "home-test", name: "Alex" } }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.stubEnv("DEV", true);
  useSpacesStore.setState({
    spaces: [
      {
        id: "home-space",
        name: "Studio",
        is_default: true,
        owner_user_id: "home-test",
        role: "owner",
        member_count: 4,
        pending_count: 0,
        is_shared: true,
        permissions: { "tasks.view": false },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const snapshot = { activity: { [dateKey(new Date())]: 2 }, recent_apps: [] };
  vi.spyOn(homeApi, "recordVisit").mockResolvedValue(snapshot);
  vi.spyOn(homeApi, "snapshot").mockResolvedValue(snapshot);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const renderHome = () =>
  render(
    <MemoryRouter>
      <HomeDashboard spaceId="home-space" />
    </MemoryRouter>,
  );

it("uses the same database history for the streak and grid", async () => {
  const real = Object.fromEntries(
    contributionDates(new Date(), 45).map((date) => [dateKey(date), 2]),
  );
  vi.mocked(homeApi.recordVisit).mockResolvedValue({ activity: real, recent_apps: [] });
  vi.mocked(homeApi.snapshot).mockResolvedValue({ activity: real, recent_apps: [] });
  window.sessionStorage.setItem("misty:home:sample-activity", "on");
  const ui = renderHome();
  expect(ui.getByLabelText("40 weeks of Home activity").children).toHaveLength(280);
  expect(ui.queryByRole("button", { name: /^(week|overview)$/i })).toBeNull();
  expect(ui.queryByText("12-day streak")).toBeNull();
  await waitFor(() => expect(ui.getByText("45-day streak")).toBeTruthy());
  expect(readHomeActivity("home-test", "home-space")).toEqual(real);
  expect(ui.queryByRole("button", { name: /Show (real|sample) activity/ })).toBeNull();
  const cells = ui.getByLabelText("40 weeks of Home activity").children;
  expect(
    Array.from(cells).filter((cell) => cell.getAttribute("title")?.startsWith("2 visits")),
  ).toHaveLength(45);
  ui.unmount();
  const next = renderHome();
  await waitFor(() => expect(next.getByText("45-day streak")).toBeTruthy());
  expect(homeApi.snapshot).toHaveBeenCalledWith("home-space");
});

it("does not substitute local counts when the database is unavailable and can retry", async () => {
  const cached = { [dateKey(new Date())]: 9 };
  cacheHomeActivity("home-test", "home-space", cached);
  vi.mocked(homeApi.recordVisit).mockRejectedValueOnce(new Error("offline"));
  const ui = renderHome();
  await waitFor(() => expect(ui.getByText("Streak unavailable")).toBeTruthy());
  expect(ui.queryByText("1-day streak")).toBeNull();
  expect(readHomeActivity("home-test", "home-space")).toEqual(cached);
  fireEvent.click(ui.getByRole("button", { name: "Retry activity" }));
  await waitFor(() => expect(ui.getByText("1-day streak")).toBeTruthy());
  expect(homeApi.recordVisit).toHaveBeenCalledTimes(2);
});

it("uses real activity in production without a screenshot toggle", async () => {
  vi.stubEnv("DEV", false);
  window.sessionStorage.setItem("misty:home:sample-activity", "on");
  const ui = renderHome();
  expect(ui.queryByRole("button", { name: /Show (real|sample) activity/ })).toBeNull();
  await waitFor(() => expect(ui.getByText("1-day streak")).toBeTruthy());
  expect(ui.getByLabelText("40 weeks of Home activity").children).toHaveLength(280);
});
