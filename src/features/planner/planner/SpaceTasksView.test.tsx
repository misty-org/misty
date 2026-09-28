import { act, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import { SpaceTasksView } from "./SpaceTasksView";
import type { PlannerTaskServices } from "./spaceTasks/taskServices";
import type { PlannerTaskIntegration } from "./spaceTasks/taskRuntime";

afterEach(cleanup);

it("loads, creates and refreshes tasks through the injected task API without a host account provider", async () => {
  const tasks: SpaceTask[] = [];
  const listTasks = vi.fn<PlannerTaskServices["tasks"]>(async () => ({
    tasks,
    status_totals: { todo: tasks.length, in_progress: 0, done: 0, canceled: 0 },
  }));
  const createTask = vi.fn<PlannerTaskServices["createTask"]>(async (_space, body) => {
    const task: SpaceTask = {
      ...body,
      id: "task-a",
      space_id: "space-a",
      task_number: 1,
      task_key: "TASK-1",
      rank: 1,
      source_refs: body.source_refs ?? [],
      version: 1,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
    };
    tasks.push(task);
    return task;
  });
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected task operation");
  };
  const api: PlannerTaskServices = {
    tasks: listTasks,
    createTask,
    updateTask: unexpected,
    moveTask: unexpected,
    archiveTask: unexpected,
  };
  const remove = vi.fn();
  let changed: (() => void) | undefined;
  let integration: PlannerTaskIntegration | undefined;
  function Integration(props: PlannerTaskIntegration) {
    useEffect(() => {
      integration = props;
    }, [props]);
    return null;
  }
  const view = render(
    <MemoryRouter initialEntries={["/spaces/space-a/planner/tasks/list"]}>
      <SpaceTasksView
        spaceId="space-a"
        canManage
        runtime={{
          api,
          userId: "user-a",
          members: [],

          subscribeChanges: (listener) => {
            changed = listener;
            return remove;
          },
          renderIntegration: (props) => <Integration {...props} />,
          renderError: (message) => <div role="alert">{message}</div>,
        }}
      />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listTasks).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.change(await screen.findByLabelText("Title"), {
    target: { value: "New task" },
  });
  expect((screen.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => {
    const error = screen.queryByRole("alert", { hidden: true });
    if (error) throw new Error(error.textContent || "Task create failed");
    expect(createTask).toHaveBeenCalledTimes(1);
  });
  expect(screen.queryByRole("alert", { hidden: true })?.textContent).toBeUndefined();
  await screen.findByText("New task");
  expect(integration?.adapter.surfaceId).toBe("planner.tasks");
  const before = listTasks.mock.calls.length;
  await act(async () => changed?.());
  await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(before + 1));
  view.unmount();
  expect(remove).toHaveBeenCalled();
});
