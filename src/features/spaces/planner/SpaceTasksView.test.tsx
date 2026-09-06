import { act, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createMistyAppSDK, type SpaceTask } from "@misty/sdk";
import { SpaceTasksView } from "./SpaceTasksView";
import { createSDKTaskServices } from "./spaceTasks/taskServices";
import type { PlannerTaskIntegration } from "./spaceTasks/taskRuntime";

afterEach(cleanup);

it("loads, creates and refreshes tasks through the injected SDK without a host account provider", async () => {
  const tasks: SpaceTask[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "lifecycle.ready") return;
    if (method === "tasks.list") return { tasks, status_totals: null };
    if (method === "tasks.create") {
      const body = (params as { body: { title: string } }).body;
      const task: SpaceTask = {
        id: "task-a",
        space_id: "space-a",
        task_number: 1,
        task_key: "TASK-1",
        title: body.title,
        notes: "",
        status: "todo",
        priority: "medium",
        rank: 1,
        due_timezone: "UTC",
        source_refs: null,
        audience_kind: "space",
        version: 1,
        created_at: "2026-09-05T00:00:00Z",
        updated_at: "2026-09-05T00:00:00Z",
      };
      tasks.push(task);
      return task;
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const sdk = createMistyAppSDK({ request });
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
          api: createSDKTaskServices(sdk),
          userId: "user-a",
          members: [],
          agents: [],
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
  await waitFor(() =>
    expect(request.mock.calls.some(([call]) => call.method === "tasks.list")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.change(await screen.findByLabelText("Title"), {
    target: { value: "SDK-created task" },
  });
  expect((screen.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => {
    const error = screen.queryByRole("alert", { hidden: true });
    if (error) throw new Error(error.textContent || "Task create failed");
    expect(request.mock.calls.filter(([call]) => call.method === "tasks.create")).toHaveLength(1);
  });
  expect(screen.queryByRole("alert", { hidden: true })?.textContent).toBeUndefined();
  await screen.findByText("SDK-created task");
  expect(integration?.adapter.surfaceId).toBe("planner.tasks");
  const before = request.mock.calls.filter(([call]) => call.method === "tasks.list").length;
  await act(async () => changed?.());
  await waitFor(() =>
    expect(request.mock.calls.filter(([call]) => call.method === "tasks.list")).toHaveLength(
      before + 1,
    ),
  );
  view.unmount();
  expect(remove).toHaveBeenCalled();
});
