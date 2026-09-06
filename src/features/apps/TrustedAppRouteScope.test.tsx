import { createContext, useContext } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { TrustedAppRouteScope } from "./TrustedAppRouteScope";

afterEach(cleanup);
const HostContext = createContext("");
function Feature() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="feature">
        {location.pathname}
        {location.search}
      </output>
      <output>{useContext(HostContext)}</output>
      <Link to="/spaces/s/planner/agenda/week">Week</Link>
      <Link to="/spaces/s/planner/roadmaps/r">Roadmap</Link>
      <Link to="/spaces/s/library?collection=images">Library</Link>
      <Link to="/spaces/another/planner/tasks/list">Other Space</Link>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
function Host() {
  const location = useLocation();
  return (
    <>
      <output data-testid="host">
        {location.pathname}
        {location.search}
      </output>
      <TrustedAppRouteScope appId="planner" spaceId="s" route={location.pathname + location.search}>
        <Feature />
      </TrustedAppRouteScope>
    </>
  );
}
function setup() {
  return render(
    <MemoryRouter initialEntries={["/apps/planner?space=s&view=tasks"]}>
      <HostContext.Provider value="host session remains in host">
        <Host />
      </HostContext.Provider>
    </MemoryRouter>,
  );
}
it("navigates subsections in the host document, preserves providers, and supports Back", () => {
  const view = setup();
  expect(view.getByText("host session remains in host")).toBeTruthy();
  expect(view.container.querySelector("iframe")).toBeNull();
  fireEvent.click(view.getByText("Week"));
  expect(view.getByTestId("host").textContent).toBe(
    "/apps/planner?space=s&view=agenda&agendaView=week",
  );
  expect(view.getByTestId("feature").textContent).toContain("/spaces/s/planner/agenda/week");
  fireEvent.click(view.getByText("Roadmap"));
  expect(view.getByTestId("feature").textContent).toContain("/spaces/s/planner/roadmaps/r");
  fireEvent.click(view.getByText("Back"));
  expect(view.getByTestId("feature").textContent).toContain("/spaces/s/planner/agenda/week");
});
it.each([
  ["Library", "/spaces/s/library?collection=images"],
  ["Other Space", "/spaces/another/planner/tasks/list"],
])("preserves cross-feature or cross-Space links: %s", (label, destination) => {
  const view = setup();
  fireEvent.click(view.getByText(label));
  expect(view.getByTestId("host").textContent).toBe(destination);
});
