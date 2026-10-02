import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
const fixture = vi.hoisted(() => ({
  activity: vi.fn(),
  load: vi.fn(),
  setAccount: vi.fn(),
}));
vi.mock("@/api/accountEvents", () => ({
  observeAccountChanges: (_account: string, _topics: string[], refresh: () => void) => {
    void refresh();
    return () => {};
  },
}));
vi.mock("../AgentsRuntime", () => ({
  useAgentsAuth: () => ({ user: { id: "owner" } }),
  runtimeAiApi: { activity: fixture.activity },
}));
vi.mock("./AgentAvatar", () => ({ AgentAvatar: () => <span>Avatar</span> }));
vi.mock("./MistyDashboard", () => ({
  MistyDashboard: ({ collection }: { collection: { activityId?: string } }) => (
    <div>Activity detail: {collection.activityId}</div>
  ),
}));
vi.mock("@/features/scheduled/ScheduledCollection", () => ({
  ScheduledCollection: () => <div>Scheduled collection</div>,
}));
vi.mock("@/features/scheduled", () => {
  const state = {
    accountId: "owner",
    tasks: [{ id: "schedule", title: "Morning brief", updated_at: "2026-10-01T08:00:00Z" }],
    load: fixture.load,
    setAccount: fixture.setAccount,
    error: null,
  };
  return { useScheduledTasksStore: Object.assign(() => state, { getState: () => state }) };
});
import { AgentCollection } from "./AgentCollection";
const onSelect = vi.fn();
function Location() {
  return <output aria-label="Current route">{useLocation().search}</output>;
}
function renderCollection() {
  render(
    <MemoryRouter>
      <AgentCollection
        agents={[
          { id: "agent", name: "Misty", enabled: true, updated_at: "2026-09-28" } as AgentProfile,
        ]}
        conversations={[
          {
            id: "chat",
            agentId: "agent",
            title: "Trip planning",
            updatedAt: "2026-09-29",
          } as GlobalAiConversation,
        ]}
        loading={false}
        error=""
        disabled={false}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onNewChat={vi.fn()}
        onRetry={vi.fn()}
      />
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.activity.mockResolvedValue({
    entries: [
      {
        id: "run",
        title: "Organize files",
        state: "completed",
        updated_at: "2026-09-30",
        events: [],
      },
    ],
  });
});
afterEach(cleanup);
it("defaults to All and combines every section in recent-activity order", async () => {
  renderCollection();
  await screen.findByRole("button", { name: "Organize files" });
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  expect(
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent),
  ).toEqual(["Morning brief", "Organize files", "Trip planning", "AvatarMisty"]);
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  expect(screen.getByRole("button", { name: "Misty" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Trip planning" })).toBeNull();
  expect(screen.getByRole("status", { name: "Current route" }).textContent).toBe("?view=agents");
});
it("opens mixed items in their original destinations", async () => {
  renderCollection();
  fireEvent.click(await screen.findByRole("button", { name: "Trip planning" }));
  expect(onSelect).toHaveBeenCalledWith("agent", false, "chat");
  fireEvent.click(await screen.findByRole("button", { name: "Organize files" }));
  expect(screen.getByText("Activity detail: run")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  fireEvent.click(await screen.findByRole("button", { name: "Morning brief" }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "Current route" }).textContent).toBe(
      "?view=scheduled&task=schedule",
    ),
  );
});
