import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./automations/AutomationsWorkspace", () => ({
  AutomationsWorkspace: (props: {
    selectedFlowId?: string;
    onSelectedFlowChange: (flowId?: string) => void;
  }) => (
    <section data-testid="automations" data-selected-flow={props.selectedFlowId ?? ""}>
      <button type="button" onClick={() => props.onSelectedFlowChange("flow-1")}>
        Open flow
      </button>
      <button type="button" onClick={() => props.onSelectedFlowChange()}>
        Back to automations
      </button>
    </section>
  ),
}));

vi.mock("./components/MistyWorkspace", () => ({
  MistyWorkspace: () => <section>Chat</section>,
}));

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

  it("restores the automation editor or listing from the tab route", async () => {
    await act(async () => root.render(agentsSurface("/agents?view=automations")));

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Open flow")
        ?.click();
    });
    const editorRoute = "/agents?view=automations&automation=flow-1";
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      editorRoute,
    );

    await act(async () => root.render(agentsSurface(editorRoute)));
    expect(
      container.querySelector('[data-testid="automations"]')?.getAttribute("data-selected-flow"),
    ).toBe("flow-1");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Back to automations")
        ?.click();
    });
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/agents?view=automations",
    );
  });
});
