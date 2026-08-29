import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { archiveTask, createTask, loadTasks, loadCalendarSources, loadIntegrations } = vi.hoisted(
  () => ({
    archiveTask: vi.fn().mockResolvedValue(undefined),
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
  }),
);

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/api/spaces/api", () => ({
  spacesApi: {
    tasks: loadTasks,
    calendarEvents: vi.fn().mockResolvedValue({ events: [] }),
    calendarSources: loadCalendarSources,
    integrations: loadIntegrations,
    createTask,
    archiveTask,
  },
}));

import { SpacePlanner } from "@/features/spaces/planner/SpacePlanner";
import { useSpacesStore } from "./store/useSpacesStore";

describe("SpacePlanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useSpacesStore.setState({ membersBySpace: {} });
    createTask.mockClear();
    archiveTask.mockReset().mockResolvedValue(undefined);
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
    expect(container.querySelector('button[aria-label="Refresh tasks"]')).not.toBeNull();
    expect(container.textContent).toContain("To do");
    expect(container.textContent).toContain("In progress");
    expect(container.textContent).toContain("Done");
    // The board scrolls sideways only; each column scrolls its own tasks, so a
    // long column no longer drags the whole board past the viewport.
    const board = container.querySelector('[aria-label="Task board"]');
    expect(board?.className).toContain("overflow-x-auto");
    expect(board?.className).toContain("overflow-y-hidden");
    const columnScrollers = board?.querySelectorAll("section > div.overflow-y-auto") ?? [];
    expect(columnScrollers.length).toBeGreaterThan(0);
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

    expect(document.body.textContent).toContain("Create task");
    expect(document.querySelector("#space-task-title")).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-header"]')).toBeNull();
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
    const status = container.querySelector(
      '[aria-label="Status for Finish taking screenshots for website"]',
    );
    expect(status).not.toBeNull();
    expect(status?.className).not.toContain("opacity-0");
    const card = status?.closest('[data-slot="card"]');
    expect(card?.className).toContain("min-h-36");
    expect(card?.className).not.toMatch(/(?:^|\s)h-36(?:\s|$)/);
    expect(card?.querySelector('[data-slot="card-title"]')?.className).toContain("text-sm");
    expect(card?.querySelector("p")?.className).toContain("line-clamp-1");
    expect(
      card?.querySelector('[aria-label="Delete Finish taking screenshots for website"]'),
    ).not.toBeNull();
    const cardActions = card?.querySelector(
      '[aria-label="Edit Finish taking screenshots for website"]',
    )?.parentElement;
    expect(cardActions?.className).toContain("opacity-0");
    expect(cardActions?.className).toContain("group-hover:opacity-100");
  });

  it("deletes a task directly from its board card after confirmation", async () => {
    loadTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-delete",
          task_key: "MST-6",
          title: "Remove this task",
          notes: "No longer needed.",
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

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Delete Remove this task"]',
    );
    expect(deleteButton).not.toBeNull();
    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Delete task?");
    expect(document.body.textContent).toContain(
      "“Remove this task” will be removed from Tasks. This action cannot be undone.",
    );
    expect(archiveTask).not.toHaveBeenCalled();

    const confirmDelete = document.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-action"]',
    );
    await act(async () => {
      confirmDelete?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(archiveTask).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Remove this task");
  });

  it("consumes a task deep link once without reopening it in a render loop", async () => {
    loadTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-linked",
          space_id: "space-new",
          task_number: 5,
          task_key: "MST-5",
          title: "Open once",
          notes: "No repeated history updates.",
          status: "todo",
          priority: "medium",
          rank: 1024,
          source_refs: [],
          due_timezone: "UTC",
          version: 1,
          created_at: "2026-08-01T12:00:00Z",
          updated_at: "2026-08-01T12:00:00Z",
        },
      ],
      status_totals: { todo: 1 },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/planner/tasks/board?task=task-linked"]}>
          <SpacePlanner spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector<HTMLInputElement>("#space-task-title")?.value).toBe("Open once");
    expect(loadTasks).toHaveBeenCalledOnce();
  });

  it("loads core tasks without requesting external calendar endpoints", async () => {
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
    expect(loadCalendarSources).not.toHaveBeenCalled();
    expect(loadIntegrations).not.toHaveBeenCalled();
  });

  it("shows core tasks immediately with integrations disabled", async () => {
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
    expect(loadIntegrations).not.toHaveBeenCalled();
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
