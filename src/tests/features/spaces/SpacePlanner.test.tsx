import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, loadTasks, loadCalendarSources, loadIntegrations } = vi.hoisted(() => ({
  createTask: vi.fn().mockResolvedValue({
    id: "task-1",
    task_key: "MST-1",
    title: "Write notes",
    notes: "",
    status: "todo",
    priority: "medium",
    rank: 1024,
    source_refs: [],
    due_timezone: "UTC",
    version: 1,
  }),
  loadTasks: vi.fn().mockResolvedValue({ tasks: [] }),
  loadCalendarSources: vi.fn().mockResolvedValue({ sources: [] }),
  loadIntegrations: vi.fn().mockResolvedValue({ integrations: [] }),
}));

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  spacesApi: {
    tasks: loadTasks,
    calendarEvents: vi.fn().mockResolvedValue({ events: [] }),
    calendarSources: loadCalendarSources,
    integrations: loadIntegrations,
    createTask,
  },
}));

import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpacePlanner } from "@/features/spaces/SpacePlanner";

describe("SpacePlanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useSpacesStore.setState({ membersBySpace: {} });
    createTask.mockClear();
    loadTasks.mockReset().mockResolvedValue({ tasks: [] });
    loadCalendarSources.mockReset().mockResolvedValue({ sources: [] });
    loadIntegrations.mockReset().mockResolvedValue({ integrations: [] });
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
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Tasks");
    expect(container.textContent).not.toContain("board view");
    expect(container.textContent).not.toContain("Calendar");
    expect(container.querySelector('button[aria-label="Sync planner"]')).not.toBeNull();
    expect(container.textContent).toContain("To do");
    expect(container.textContent).toContain("In progress");
    expect(container.textContent).toContain("Done");
  });

  it("opens the existing task drawer from a task creation query", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board?create=task"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("New task");
    expect(document.querySelector("#space-task-title")).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain(
      "bg-charcoal-card",
    );
  });

  it("shows task notes without an unassigned placeholder avatar", async () => {
    loadTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-detailed",
          task_key: "MST-4",
          title: "Finish taking screenshots for website",
          notes: "Capture the final light and dark production states.",
          status: "todo",
          priority: "medium",
          rank: 1024,
          source_refs: [],
          due_timezone: "UTC",
          version: 1,
        },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Capture the final light and dark production states.");
    expect(container.querySelector('[title="Unassigned"]')).toBeNull();
  });

  it("keeps core tasks available when optional calendar endpoints fail", async () => {
    loadTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-existing",
          task_key: "MST-2",
          title: "Ship beta",
          notes: "",
          status: "todo",
          priority: "medium",
          rank: 1024,
          source_refs: [],
          due_timezone: "UTC",
          version: 1,
        },
      ],
    });
    loadCalendarSources.mockRejectedValue(new Error("Calendar endpoint unavailable"));
    loadIntegrations.mockRejectedValue(new Error("Provider endpoint unavailable"));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/list"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Ship beta");
    expect(container.textContent).toContain("Tasks are available");
  });

  it("shows core tasks without waiting for slow optional provider discovery", async () => {
    let releaseIntegrations!: (value: { integrations: never[] }) => void;
    loadTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-fast",
          task_key: "MST-3",
          title: "Available immediately",
          notes: "",
          status: "todo",
          priority: "medium",
          rank: 1024,
          source_refs: [],
          due_timezone: "UTC",
          version: 1,
        },
      ],
    });
    loadIntegrations.mockImplementation(
      () => new Promise((resolve) => (releaseIntegrations = resolve)),
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/list"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Available immediately");

    await act(async () => {
      releaseIntegrations({ integrations: [] });
      await Promise.resolve();
    });
  });

  it("does not send blank optional date and assignee fields when quick-adding a task", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const createButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Drop or create",
    );
    await act(async () => createButton?.click());
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Task title"]');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Write notes",
      );
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input!.closest("form");
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(createTask).toHaveBeenCalledOnce();
    const payload = createTask.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: "Write notes",
      notes: "",
      status: "todo",
      priority: "medium",
    });
    expect(payload).not.toHaveProperty("due_at");
    expect(payload).not.toHaveProperty("assignee_user_id");
  });

  it("includes notes when saving a task from the drawer", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const createButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "New",
    );
    await act(async () => createButton?.click());
    // The shadcn Sheet renders into a portal attached to the document body.
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Title"]');
    const notes = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add notes"]');
    expect(title).not.toBeNull();
    expect(notes).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        title,
        "Write notes",
      );
      title!.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        notes,
        "Keep the useful details.",
      );
      notes!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(createTask).toHaveBeenCalledOnce();
    expect(createTask.mock.calls[0]?.[1]).toMatchObject({
      title: "Write notes",
      notes: "Keep the useful details.",
    });
  });
});
