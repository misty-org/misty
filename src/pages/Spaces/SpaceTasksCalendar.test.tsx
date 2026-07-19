import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("../../spaces/api", () => ({
  spacesApi: {
    tasks: vi.fn().mockResolvedValue({ tasks: [] }),
    calendarEvents: vi.fn().mockResolvedValue({ events: [] }),
    calendarSources: vi.fn().mockResolvedValue({ sources: [] }),
  },
}));
vi.mock("../../spaces/agentArchitectureApi", () => ({
  agentArchitectureApi: { integrations: vi.fn().mockResolvedValue({ integrations: [] }) },
}));

import { useSpacesStore } from "../../stores/useSpacesStore";
import { SpaceTasksCalendar } from "./SpaceTasksCalendar";

describe("SpaceTasksCalendar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useSpacesStore.setState({ membersBySpace: {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders with a stable empty member snapshot while coordination data loads", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/tasks/board"]}>
          <SpaceTasksCalendar spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Board");
    expect(container.textContent).toContain("List");
    expect(container.textContent).toContain("Calendar");
    expect(container.textContent).toContain("To do");
    expect(container.textContent).toContain("In progress");
    expect(container.textContent).toContain("Done");
  });
});
