import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTask } = vi.hoisted(() => ({
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
}));

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("../../spaces/api", () => ({
  spacesApi: {
    tasks: vi.fn().mockResolvedValue({ tasks: [] }),
    calendarEvents: vi.fn().mockResolvedValue({ events: [] }),
    calendarSources: vi.fn().mockResolvedValue({ sources: [] }),
    createTask,
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
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useSpacesStore.setState({ membersBySpace: {} });
    createTask.mockClear();
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

  it("does not send blank optional date and assignee fields when quick-adding a task", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-new/tasks/board"]}>
          <SpaceTasksCalendar spaceId="space-new" canManage canManageIntegrations />
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
        <MemoryRouter initialEntries={["/spaces/space-new/tasks/board"]}>
          <SpaceTasksCalendar spaceId="space-new" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const createButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Create",
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
