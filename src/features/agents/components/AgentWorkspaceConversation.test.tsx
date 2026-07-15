import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCompanionPresentation, useCompanionState } from "../companion/companionState";
import { AgentCompanionPanel } from "../companion/AgentCompanionPanel";
import { AgentWorkspaceConversation } from "./AgentWorkspaceConversation";
vi.mock("@/features/global-search/MistyModelPicker", () => ({
  MistyModelPicker: () => null,
}));
vi.mock("./AgentConversationView", () => ({
  AgentConversationView: () => <div>Conversation messages</div>,
}));
const finishExecutionMock = vi.fn(async () => {});
vi.mock("@/features/agents/localExecution", () => ({
  finishLocalExecution: () => finishExecutionMock(),
}));
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
const submit = vi.fn(async (..._args: unknown[]) => {});
const agent = {
  id: "writer",
  name: "Writing partner",
  role: "Help me write",
  enabled: true,
  avatar: {},
  model_mode: "automatic",
} as AgentProfile;
const renderWorkspace = (profile = agent) =>
  render(
    <MemoryRouter>
      <AgentWorkspaceConversation
        agent={profile}
        spaceId="studio"
        accountId="owner"
        onCreate={() => {}}
      />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  useCompanionState.setState({
    accountId: "owner",
    submit: async ({ prompt, attachments, conversationId }) =>
      submit(
        prompt,
        attachments,
        undefined,
        "workspace",
        [],
        { conversationId, context: [] },
        {
          executionMode: "agent",
          interactionMode: useCompanionState.getState().presentation.mode,
          model: "",
        },
      ),
    presentation: initialCompanionPresentation,
    control: async (control) => {
      await finishExecutionMock();
      if (control.kind === "ask")
        useCompanionState.setState((s) => ({
          presentation: {
            ...s.presentation,
            ask: control.ask,
          },
        }));
    },
  });
  useMistyStore.setState({
    accountId: "owner",
    selectedAgentId: "another-agent",
    selectedSpaceId: "another-space",
    activeConversationId: "",
    conversations: [],
    working: false,
    error: null,
    loadConversations: async () => {},
    submitAnswer: submit,
    executionMode: "user",
  });
  Object.defineProperty(window.navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});
afterEach(cleanup);
describe("Agents workspace conversations", () => {
  it("uses one natural flow with Ask off by default", async () => {
    render(<AgentCompanionPanel />);
    expect(screen.queryByRole("radiogroup", { name: "Companion mode" })).toBeNull();
    const ask = screen.getByRole("switch", { name: "Ask before taking control" });
    expect(ask.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(ask);
    await waitFor(() => expect(useCompanionState.getState().presentation.ask).toBe(true));
    expect(finishExecutionMock).toHaveBeenCalledOnce();
    expect(ask.getAttribute("aria-checked")).toBe("true");
  });
  it("submits to the displayed agent without binding its conversation to a Space", async () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: {
        value: "Draft a launch note",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send to Misty",
      }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(useMistyStore.getState()).toMatchObject({
      selectedAgentId: "writer",
      selectedSpaceId: "",
    });
    expect(submit).toHaveBeenCalledWith(
      "Draft a launch note",
      [],
      undefined,
      "workspace",
      [],
      {
        conversationId: "",
        context: [],
      },
      {
        executionMode: "agent",
        interactionMode: "auto",
        model: "",
      },
    );
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe("");
  });
  it("keeps a failed draft available to retry", async () => {
    submit.mockImplementationOnce(async () => {
      useMistyStore.setState({
        error: "Connection interrupted",
      });
    });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: {
        value: "Keep this draft",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send to Misty",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Connection interrupted"),
    );
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
      "Keep this draft",
    );
  });
  it("leaves the empty conversation focused on the composer", () => {
    renderWorkspace();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Ask before taking control" })).toBeNull();
    expect(screen.getByLabelText("Message Misty")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not send to a disabled agent", () => {
    renderWorkspace({
      ...agent,
      enabled: false,
    });
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: {
        value: "Hello",
      },
    });
    fireEvent.keyDown(screen.getByLabelText("Message Misty"), {
      key: "Enter",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Send to Misty",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

it("sends follow-ups to the scheduled conversation even when another chat is globally active", async () => {
  useMistyStore.setState({
    activeConversationId: "other-chat",
    conversations: ["scheduled-chat", "other-chat"].map((id) => ({
      id,
      agentId: agent.id,
      title: id,
      messages: [],
      remote: false,
      createdAt: "",
      updatedAt: "",
      spaceId: "",
    })),
  });
  render(
    <MemoryRouter>
      <AgentWorkspaceConversation
        agent={agent}
        conversationId="scheduled-chat"
        accountId="owner"
        spaceId=""
        onCreate={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Message Misty"), {
    target: { value: "Expand on the last run" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0][5]).toEqual({ conversationId: "scheduled-chat", context: [] });
});
