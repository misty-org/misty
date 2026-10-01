import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScheduledTask } from "@/api/scheduled/api";
import type { AgentProfile } from "@/shared/schemas";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { ScheduledPage } from "./ScheduledPage";
import { useScheduledTasksStore } from "./useScheduledTasksStore";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/features/agents/components/AgentWorkspaceConversation", () => ({
  AgentWorkspaceConversation: (props: {
    agent: AgentProfile;
    conversationId: string;
    onDraftStateChange: (s: { dirty: boolean; busy: boolean }) => void;
  }) => (
    <section aria-label={`${props.agent.name} chat`}>
      <span>{props.conversationId}</span>
      <button onClick={() => props.onDraftStateChange({ dirty: true, busy: false })}>
        Draft message
      </button>
    </section>
  ),
}));
const task: ScheduledTask = {
  id: "briefing",
  agent_id: "research",
  conversation_id: "chat-briefing",
  title: "Morning briefing",
  prompt: "Summarize my day.",
  enabled: true,
  state: "idle",
  cadence: "daily",
  local_time: "09:00",
  weekday: 1,
  month_day: 1,
  timezone: "America/Los_Angeles",
  run_count: 0,
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
};
const load = vi.fn(async () => {});
const create = vi.fn(async (input) => ({ ...task, ...input, id: "created" }));
beforeEach(() => {
  useScheduledTasksStore.setState({
    accountId: "owner",
    tasks: [
      task,
      {
        ...task,
        id: "paused",
        conversation_id: "chat-review",
        title: "Weekly review",
        enabled: false,
      },
    ],
    state: "ready",
    load,
    create,
  });
  usePersonalAgentsStore.setState({
    accountId: "owner",
    loading: false,
    error: "",
    load: vi.fn(async () => {}),
    agents: [
      { id: "research", name: "Research partner", enabled: true },
      { id: "misty", name: "Misty", enabled: true, system_managed: true },
    ] as AgentProfile[],
  });
  useMistyStore.setState({
    accountId: "owner",
    working: false,
    conversationsLoading: false,
    loadConversations: async () => {},
    conversations: ["chat-briefing", "chat-review"].map((id) => ({
      id,
      agentId: "research",
      title: id,
      messages: [],
      remote: false,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      spaceId: "",
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const renderPage = (entry = "/scheduled") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ScheduledPage />
    </MemoryRouter>,
  );
it("opens a linked task beside its assigned agent conversation and schedule", () => {
  const ui = renderPage("/scheduled?task=paused");
  expect(ui.getByRole("region", { name: "Research partner chat" }).textContent).toContain(
    "chat-review",
  );
  expect(ui.getByRole("button", { name: "Resume" })).toBeTruthy();
  expect(ui.getByRole("button", { name: /Morning briefing/ })).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: /Morning briefing/ }));
  expect(ui.getByRole("region", { name: "Research partner chat" }).textContent).toContain(
    "chat-briefing",
  );
});
it("protects an unsent follow-up when changing tasks", () => {
  const ui = renderPage("/scheduled?task=briefing");
  fireEvent.click(ui.getByRole("button", { name: "Draft message" }));
  fireEvent.click(ui.getByRole("button", { name: /Weekly review/ }));
  expect(ui.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Keep writing" }));
  expect(ui.getByText("chat-briefing")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: /Weekly review/ }));
  fireEvent.click(ui.getByRole("button", { name: "Discard and switch" }));
  expect(ui.getByText("chat-review")).toBeTruthy();
});
it("creates a task with the selected agent", async () => {
  const ui = renderPage("/scheduled?task=briefing");
  fireEvent.click(ui.getByRole("button", { name: "New task" }));
  fireEvent.change(ui.getByLabelText("Name"), { target: { value: "Daily research" } });
  fireEvent.change(ui.getByRole("textbox", { name: "Instructions" }), {
    target: { value: "Find relevant papers" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: "research",
        title: "Daily research",
        prompt: "Find relevant papers",
      }),
    ),
  );
});
it("keeps cached tasks visible after a loading error and supports search", () => {
  useScheduledTasksStore.setState({ state: "error" });
  const ui = renderPage("/scheduled?task=briefing");
  expect(ui.getByRole("alert").textContent).toContain("couldn’t load");
  fireEvent.click(ui.getByRole("button", { name: "Try again" }));
  expect(load).toHaveBeenCalledTimes(2);
  fireEvent.click(ui.getByRole("button", { name: "Search tasks" }));
  fireEvent.change(ui.getByLabelText("Search scheduled tasks"), { target: { value: "Weekly" } });
  expect(ui.queryByRole("button", { name: /Morning briefing/ })).toBeNull();
  expect(ui.getByRole("button", { name: /Weekly review/ })).toBeTruthy();
});
it("does not substitute another agent for a removed task owner", () => {
  useScheduledTasksStore.setState({ tasks: [{ ...task, agent_id: "removed" }] });
  const ui = renderPage("/scheduled?task=briefing");
  expect(ui.getByRole("heading", { name: "Agent unavailable" })).toBeTruthy();
  expect(ui.queryByRole("region", { name: /chat/ })).toBeNull();
});
it("announces loading without showing an empty state", () => {
  useScheduledTasksStore.setState({ tasks: [], state: "loading" });
  const ui = renderPage("/scheduled?task=briefing");
  expect(ui.getByLabelText("Loading scheduled tasks")).toBeTruthy();
  expect(ui.queryByText("Create your first task")).toBeNull();
});

it("opens the overview without selecting a task and prefills a suggestion without saving", () => {
  const ui = renderPage();
  expect(ui.getByRole("heading", { name: "Make time for what matters" })).toBeTruthy();
  expect(ui.queryByRole("region", { name: /chat/ })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Evening reflection" }));
  expect((ui.getByLabelText("Name") as HTMLInputElement).value).toBe("Evening reflection");
  expect((ui.getByLabelText("Time") as HTMLInputElement).value).toBe("20:30");
  expect(
    (ui.getByRole("textbox", { name: "Instructions" }) as HTMLTextAreaElement).value,
  ).toContain("reflect");
  expect(create).not.toHaveBeenCalled();
});

it("protects an unsent message before returning to the overview", () => {
  const ui = renderPage("/scheduled?task=briefing");
  fireEvent.click(ui.getByRole("button", { name: "Draft message" }));
  fireEvent.click(ui.getByRole("button", { name: "Scheduled overview" }));
  expect(ui.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Discard and switch" }));
  expect(ui.getByRole("heading", { name: "Make time for what matters" })).toBeTruthy();
});

it("loads agents on a direct Scheduled visit and enables a starter when they arrive", async () => {
  const loadAgents = vi.fn(async () => {});
  usePersonalAgentsStore.setState({ agents: [], loading: true, load: loadAgents });
  const ui = renderPage();
  expect(loadAgents).toHaveBeenCalledWith("owner");
  fireEvent.click(ui.getByRole("button", { name: "Morning overview" }));
  expect((ui.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () =>
    usePersonalAgentsStore.setState({
      loading: false,
      agents: [
        { id: "misty", name: "Misty", enabled: true, system_managed: true },
      ] as AgentProfile[],
    }),
  );
  expect((ui.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(ui.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: "misty", title: "Morning overview" }),
    ),
  );
});
it("lets an agent-loading failure recover without closing the draft", async () => {
  const loadAgents = vi.fn(async () => {});
  usePersonalAgentsStore.setState({
    agents: [],
    loading: false,
    error: "Offline",
    load: loadAgents,
  });
  const ui = renderPage();
  fireEvent.click(ui.getByRole("button", { name: "New task" }));
  fireEvent.change(ui.getByLabelText("Name"), { target: { value: "Keep this draft" } });
  fireEvent.click(ui.getByRole("button", { name: "Retry agents" }));
  expect(loadAgents).toHaveBeenCalledTimes(2);
  expect((ui.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep this draft");
});
it("filters upcoming and paused tasks with a checked menu choice", () => {
  const ui = renderPage();
  fireEvent.pointerDown(ui.getByRole("button", { name: "Filter tasks" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(ui.getByRole("menuitemradio", { name: "Paused" }));
  expect(ui.queryByRole("button", { name: /Morning briefing/ })).toBeNull();
  expect(ui.getByRole("button", { name: /Weekly review/ })).toBeTruthy();
});
