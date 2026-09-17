import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spacesApi } from "@/api/spaces/api";
import { useAppsStore } from "@/features/apps";
import { homeApi } from "@/api/home/api";
import { useSpacesStore } from "@/features/spaces";
import { GlobalHomeDashboard } from "./GlobalHomeDashboard";
import { useWorkspaceStore } from "@/features/workspace";
import { HomeDashboard } from "./HomeDashboard";
import { cacheHomeActivity, contributionDates, dateKey, readHomeActivity } from "./homeActivity";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "home-test", name: "Alex" } }),
}));

beforeEach(() => {
  useAppsStore.setState({ installations: [] });
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.stubEnv("DEV", true);
  useSpacesStore.setState({
    loading: false,
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
  expect(homeApi.snapshot).toHaveBeenCalledWith("home-space", undefined);
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

it("keeps global Home independent of Spaces while retaining Space shortcuts", async () => {
  const studio = useSpacesStore.getState().spaces[0];
  useSpacesStore.setState({
    spaces: [studio, { ...studio, id: "launch", name: "Launch", is_default: false }],
  });
  useWorkspaceStore.setState({ activeScopeKey: "space:launch" });
  const ui = render(
    <MemoryRouter>
      <GlobalHomeDashboard />
    </MemoryRouter>,
  );
  expect(ui.queryByRole("combobox")).toBeNull();
  expect(ui.queryByText("Agenda and app shortcuts")).toBeNull();
  expect(ui.getByRole("heading", { name: "Agenda" })).toBeTruthy();
  expect(ui.getByRole("link", { name: /Studio/ }).getAttribute("href")).toBe(
    "/spaces/home-space/home",
  );
  expect(ui.getByRole("link", { name: /Launch/ }).getAttribute("href")).toBe("/spaces/launch/home");
  await waitFor(() =>
    expect(homeApi.recordVisit).toHaveBeenCalledWith(undefined, expect.any(String), "home-space"),
  );
  act(() => useWorkspaceStore.setState({ activeScopeKey: "space:home-space" }));
  expect(homeApi.recordVisit).toHaveBeenCalledTimes(1);
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:home-space");
});

it("renders Home and personal app shortcuts without any Space", async () => {
  useSpacesStore.setState({ spaces: [], loading: false });
  const agenda = vi.spyOn(spacesApi, "agenda");
  useAppsStore.setState({
    installations: [{ app_id: "files", state: "installed" }] as ReturnType<
      typeof useAppsStore.getState
    >["installations"],
  });
  const ui = render(
    <MemoryRouter>
      <GlobalHomeDashboard />
    </MemoryRouter>,
  );
  expect(ui.getByRole("heading", { level: 1 }).textContent).toContain("Alex");
  expect(ui.getByRole("link", { name: /Files/ }).getAttribute("href")).toBe("/apps/files");
  expect(ui.getByRole("link", { name: "Create a Space" }).getAttribute("href")).toBe("/spaces");
  await waitFor(() => expect(ui.getByText("1-day streak")).toBeTruthy());
  expect(agenda).not.toHaveBeenCalled();
  expect(homeApi.recordVisit).toHaveBeenCalledWith(undefined, expect.any(String), undefined);
});

it("restores today's agenda across readable Spaces, sorted and linked to their source", async () => {
  const studio = useSpacesStore.getState().spaces[0];
  useSpacesStore.setState({
    spaces: [
      { ...studio, permissions: { "tasks.view": true } },
      { ...studio, id: "launch", name: "Launch", permissions: { "tasks.view": true } },
      { ...studio, id: "restricted", permissions: { "tasks.view": false } },
    ],
  });
  const entry = (id: string, hour: number, status = "pending") => ({
    id,
    kind: "task" as const,
    title: id,
    status,
    all_day: false,
    timezone: "UTC",
    starts_at: `2026-09-17T${hour}:00:00Z`,
    ends_at: `2026-09-17T${hour}:30:00Z`,
  });
  const agenda = vi.spyOn(spacesApi, "agenda").mockImplementation(async (id) => ({
    entries:
      id === "launch"
        ? [entry("Earlier task", 10)]
        : [entry("Later task", 14), entry("Done", 12, "completed")],
  }));
  const ui = render(
    <MemoryRouter>
      <GlobalHomeDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(ui.getByText("Earlier task")).toBeTruthy());
  const section = ui.getByRole("region", { name: "Agenda" });
  expect(section.textContent!.indexOf("Earlier task")).toBeLessThan(
    section.textContent!.indexOf("Later task"),
  );
  expect(ui.queryByText("Done")).toBeNull();
  expect(ui.getByRole("link", { name: /Earlier task/ }).getAttribute("href")).toBe(
    "/spaces/launch/planner/agenda/day",
  );
  expect(agenda).toHaveBeenCalledTimes(2);
  expect(agenda.mock.calls.map(([id]) => id)).toEqual(["home-space", "launch"]);
});

it("retains available agenda items when another Space fails to load", async () => {
  const studio = useSpacesStore.getState().spaces[0];
  useSpacesStore.setState({
    spaces: [
      { ...studio, permissions: { "tasks.view": true } },
      { ...studio, id: "offline", permissions: { "tasks.view": true } },
    ],
  });
  vi.spyOn(spacesApi, "agenda").mockImplementation(async (id) => {
    if (id === "offline") throw new Error("offline");
    return {
      entries: [
        {
          id: "task",
          kind: "task",
          title: "Available task",
          starts_at: new Date().toISOString(),
          ends_at: new Date().toISOString(),
          all_day: false,
          timezone: "UTC",
        },
      ],
    };
  });
  const ui = render(
    <MemoryRouter>
      <GlobalHomeDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(ui.getByText("Available task")).toBeTruthy());
  expect(ui.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(ui.queryByText("Your day is clear.")).toBeNull();
});
