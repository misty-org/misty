import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentMethod } from "@/api/ai/agent-methods";
import { AgentMethodsCatalog } from "./AgentMethodsCatalog";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  instantiate: vi.fn(),
  save: vi.fn(),
  schedules: vi.fn(),
  schedule: vi.fn(),
  submit: vi.fn(),
  newConversation: vi.fn(),
  state: { accountId: "account", conversations: [], working: false, error: null },
}));
vi.mock("@/api/ai/agent-methods", () => ({
  agentMethodsApi: { list: mocks.list, instantiate: mocks.instantiate, save: mocks.save },
}));
vi.mock("@/api/scheduled/api", () => ({
  scheduledTasksApi: { list: mocks.schedules, create: mocks.schedule },
}));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: Object.assign((selector: (state: unknown) => unknown) => selector(mocks.state), {
    getState: () => ({
      ...mocks.state,
      newConversation: mocks.newConversation,
      submitAnswer: mocks.submit,
    }),
    setState: vi.fn(),
  }),
}));
const method: AgentMethod = {
  id: "method",
  agent_id: "agent",
  kind: "workflow",
  enabled: true,
  version: 4,
  version_id: "version4",
  updated_at: "2026-10-03",
  definition: {
    title: "Brief",
    description: "Read the selected source",
    instructions: "Summarize the source.",
    inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
    target: "cloud",
    required_tools: [],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ methods: [method] });
  mocks.schedules.mockResolvedValue({ tasks: [] });
  mocks.instantiate.mockResolvedValue({ prompt: "Rendered instructions", method });
  mocks.newConversation.mockResolvedValue("conversation");
  mocks.submit.mockResolvedValue(undefined);
  mocks.schedule.mockResolvedValue({
    task: {
      ...method,
      id: "schedule",
      title: "Brief",
      method_version_id: "version4",
      local_time: "09:00",
      timezone: "America/Los_Angeles",
      cadence: "daily",
    },
  });
});
function catalog(kind: "workflow" | "template" = "workflow") {
  const onUse = vi.fn();
  const onConversation = vi.fn();
  render(
    <MemoryRouter>
      <AgentMethodsCatalog
        agentId="agent"
        kind={kind}
        onUse={onUse}
        onConversation={onConversation}
        onStartWork={(action) => action()}
      />
    </MemoryRouter>,
  );
  return { onUse, onConversation };
}
it("runs the selected immutable version with typed values through the shared invocation lifecycle", async () => {
  const { onConversation } = catalog();
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Space exploration" } });
  fireEvent.click(screen.getByRole("button", { name: "Run workflow" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
  expect(mocks.instantiate).toHaveBeenCalledWith("version4", { topic: "Space exploration" });
  expect(mocks.submit.mock.calls[0][6]).toEqual(
    expect.objectContaining({
      methodVersionId: "version4",
      methodInputs: { topic: "Space exploration" },
      executionMode: "user",
    }),
  );
  await waitFor(() => expect(onConversation).toHaveBeenCalledWith("conversation"));
});
it("instantiates a template into a draft without invoking an agent", async () => {
  mocks.list.mockResolvedValue({ methods: [{ ...method, kind: "template" }] });
  const { onUse } = catalog("template");
  fireEvent.click(await screen.findByRole("button", { name: "Use template" }));
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "A subject" } });
  fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
  await waitFor(() => expect(onUse).toHaveBeenCalledWith("Rendered instructions"));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.newConversation).not.toHaveBeenCalled();
});
it("saves a schedule with a pinned version and inputs without starting a task", async () => {
  catalog();
  fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Weekly research" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() =>
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        method_version_id: "version4",
        method_inputs: { topic: "Weekly research" },
        cadence: "daily",
        local_time: "09:00",
      }),
    ),
  );
  expect(mocks.submit).not.toHaveBeenCalled();
});

afterEach(cleanup);
