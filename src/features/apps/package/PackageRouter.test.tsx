import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLocation, useNavigate } from "react-router-dom";
import { PackageRouter } from "./PackageRouter";
import { packageRoute, hostAppRoute } from "./routes";
import type { OfficialAppPackageMountProps } from "./types";

afterEach(cleanup);
const base = {
  route: "/apps/planner",
  search: "?space=s&view=tasks",
  session: { appId: "planner", spaceId: "s" },
  tab: { id: "tab", route: "/apps/planner" },
} as OfficialAppPackageMountProps;
function Screen() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>{location.pathname}</output>
      <button onClick={() => navigate("/spaces/s/planner/agenda/week")}>Week</button>
    </>
  );
}
it("switches the mounted screen when the host chooses a subsection and reports internal navigation", async () => {
  const changed = vi.fn();
  const props = { ...base, onWorkspaceTabChange: changed };
  const view = render(<PackageRouter props={props} renderApp={() => <Screen />} />);
  expect(view.getByText("/spaces/s/planner/tasks/board")).toBeTruthy();
  view.rerender(
    <PackageRouter
      props={{ ...props, search: "?space=s&view=agenda" }}
      renderApp={() => <Screen />}
    />,
  );
  await waitFor(() => expect(view.getByText("/spaces/s/planner/agenda/month")).toBeTruthy());
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(view.getByText("Week"));
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/apps/planner?space=s&view=agenda&agendaView=week" }),
    ),
  );
});
it.each([
  ["planner", "?view=roadmaps&roadmap=r", "/spaces/s/planner/roadmaps/r"],
  ["planner", "?view=tasks&taskView=list", "/spaces/s/planner/tasks/list"],
  ["journal", "?view=drawings&drawing=d", "/spaces/s/drawings/d"],
  ["journal", "?view=notes", "/spaces/s/notes"],
  ["chat", "?provider=discord", "/spaces/s/social/discord"],
  ["library", "?collection=albums", "/spaces/s/library"],
])("preserves %s subsection links through a round trip", (app, query, pathname) => {
  const internal = packageRoute(app, "s", `/apps/${app}${query}`);
  expect(new URL(internal, "https://misty.local").pathname).toBe(pathname);
  expect(
    new URL(packageRoute(app, "s", hostAppRoute(app, "s", internal)), "https://misty.local")
      .pathname,
  ).toBe(pathname);
});

it.each([
  ["/spaces/s/notes?view=list&note=n", "noteView", "list"],
  ["/spaces/s/notes?view=doc&note=n", "noteView", "doc"],
  ["/spaces/s/drawings/d?view=list", "drawingView", "list"],
  ["/spaces/s/drawings/d?view=canvas", "drawingView", "canvas"],
])("preserves Journal preview/editor state for %s", (route, key, page) => {
  const host = hostAppRoute("journal", "s", route);
  expect(new URL(host, "https://misty.local").searchParams.get(key)).toBe(page);
  const restored = new URL(packageRoute("journal", "s", host), "https://misty.local");
  expect(restored.searchParams.get("view")).toBe(page);
  expect(restored.pathname).toBe(new URL(route, "https://misty.local").pathname);
});
