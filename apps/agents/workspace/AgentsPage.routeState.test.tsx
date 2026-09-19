import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/MistyDashboard",()=>({MistyDashboard:()=> <section data-testid="activity">Misty activity</section>}));

vi.mock("./mcp/McpConnectionsSheet", () => ({
  McpConnectionsSheet: () => null,
}));

import AgentsPage from "./AgentsPage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function agentsSurface(entry: string) {
  return (
    <MemoryRouter key={entry} initialEntries={[entry]}>
      <AgentsPage />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe("Agents automation route state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the dashboard for old automation links without removing saved workflow data",async()=>{
    await act(async()=>root.render(agentsSurface("/agents?view=automations&automation=flow-1")));
    expect(container.querySelector('[data-testid="activity"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe("/agents?view=automations&automation=flow-1");
  });
});
