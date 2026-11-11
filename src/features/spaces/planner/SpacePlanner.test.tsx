import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceCalendarEvent, SpaceTask } from "./api";

const now = new Date();
const today = (hour: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).toISOString();

const task = (patch: Partial<SpaceTask>): SpaceTask => ({
  id: "task-1",
  space_id: "space-1",
  task_number: 1,
  title: "Write the brief",
  notes: "",
  status: "todo",
  priority: "high",
  rank: 1024,
  assignee_agent_id: "agent-1",
  due_at: today(12),
  created_by_user_id: "user-1",
  version: 1,
  created_at: "",
  updated_at: "",
  ...patch,
});
const meeting: SpaceCalendarEvent = {
  id: "event-1",
  space_id: "space-1",
  title: "Planning call",
  description: "",
  location: "",
  starts_at: today(9),
  ends_at: today(10),
  all_day: false,
  timezone: "UTC",
  created_by_user_id: "user-1",
  version: 1,
  created_at: "",
  updated_at: "",
};

const todayKey = vi.hoisted(() => {
  const date = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
});
const api = vi.hoisted(() => ({
  tasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  moveTask: vi.fn(),
  archiveTask: vi.fn(),
  events: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
vi.mock("./api", () => ({ plannerApi: api }));
vi.mock("../list/useSpacesStore", () => {
  const state = {
    membersBySpace: { "space-1": [{ user_id: "user-1", name: "Matt", email: "m@example.com" }] },
    loadMembers: () => Promise.resolve(),
  };
  return { useSpacesStore: (select: (value: typeof state) => unknown) => select(state) };
});
vi.mock("../members/agents/useSpaceAgentMembers", () => ({
  useSpaceAgentMembers: () => ({
    agents: [{ agent_id: "agent-1", agent_name: "Researcher", owner_name: "Matt" }],
  }),
}));
vi.mock("@/features/agents/connectedAppsPublic", () => ({
  appsApi: { list: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
  connectedCalendarEvents: () =>
    Promise.resolve([
      {
        id: "ca_1:e1",
        account: "ca_1",
        title: "Dentist",
        location: "",
        starts_at: "",
        ends_at: "",
        all_day: true,
        day: todayKey,
        url: "",
      },
    ]),
}));

import { SpaceCalendar } from "../calendar/SpaceCalendar";
import { SpacePlanner } from "./SpacePlanner";

describe("a Space's planner and calendar", () => {
  let host: HTMLDivElement;
  let root: Root;
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const column = (name: string) =>
    host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.values(api).forEach((mock) => mock.mockReset());
    api.tasks.mockResolvedValue({
      tasks: [
        task({}),
        task({
          id: "task-2",
          task_number: 2,
          title: "Review it",
          status: "done",
          due_at: undefined,
        }),
      ],
    });
    api.events.mockResolvedValue({ events: [meeting] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows each task in its column, with who it is assigned to", async () => {
    act(() => root.render(<SpacePlanner spaceId="space-1" />));
    expect(host.textContent).not.toContain("Loading");
    await settle();
    expect(column("To do").textContent).toContain("Write the brief");
    expect(column("To do").textContent).toContain("T-1");
    expect(column("To do").textContent).toContain("Researcher (Matt’s agent)");
    expect(column("Done").textContent).toContain("Review it");
    expect(column("In progress").querySelectorAll("[data-reorder-item]")).toHaveLength(0);
  });

  it("adds a task to the column it was typed in", async () => {
    const shipped = task({ id: "task-3", task_number: 3, title: "Ship", status: "in_progress" });
    api.createTask.mockImplementation(() => {
      // The board loads again after a change, as it does when someone else makes one.
      api.tasks.mockResolvedValue({ tasks: [task({}), shipped] });
      return Promise.resolve(shipped);
    });
    act(() => root.render(<SpacePlanner spaceId="space-1" />));
    await settle();
    act(() =>
      column("In progress")
        .querySelector<HTMLButtonElement>('[aria-label="New task in In progress"]')!
        .click(),
    );
    const input = column("In progress").querySelector<HTMLInputElement>("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Ship",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(api.createTask).toHaveBeenCalledWith("space-1", {
      title: "Ship",
      status: "in_progress",
    });
    expect(column("In progress").textContent).toContain("Ship");
  });

  it("puts events and due tasks on the calendar's days", async () => {
    act(() => root.render(<SpaceCalendar spaceId="space-1" />));
    await settle();
    const day = host.querySelector<HTMLElement>(`section[aria-label="${now.toDateString()}"]`)!;
    expect(day.textContent).toContain("Planning call");
    expect(day.textContent).toContain("Write the brief");
    // The person's own connected calendar is drawn with the Space's.
    expect(day.textContent).toContain("Dentist");
    const [from, to] = api.events.mock.calls[0].slice(1) as string[];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeGreaterThan(41 * 86_400_000);
  });
});
