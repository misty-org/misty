import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { AgentWorkspaceConversation } from "./AgentWorkspaceConversation";
import type { AgentProfile } from "@misty/contracts";

vi.mock("@/features/global-search/MistyModelPicker", () => ({ MistyModelPicker: () => null }));
vi.mock("./AgentConversationView", () => ({
  AgentConversationView: () => <div>Conversation messages</div>,
}));
import { useCompanionState, initialCompanionPresentation } from "../companion/companionState";
const finishExecutionMock = vi.fn(async () => {});
vi.mock("@/features/agents/localExecution", () => ({
  finishLocalExecution: () => finishExecutionMock(),
}));
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
const submit = vi.fn(async () => {});
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
    presentation: initialCompanionPresentation,
    control: async (control) => {
      await finishExecutionMock();
      if (control.kind === "mode")
        useCompanionState.setState((s) => ({
          presentation: { ...s.presentation, mode: control.mode },
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
  it("uses shared Team/Auto controls and removes the old User/Agent modes", async () => {
    renderWorkspace();
    expect(screen.queryByRole("radio", { name: "User" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Agent" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Team" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    await waitFor(() => expect(useCompanionState.getState().presentation.mode).toBe("auto"));
    expect(finishExecutionMock).toHaveBeenCalledOnce();
    const auto = screen.getByRole("radio", { name: "Auto" });
    expect(auto.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Team" }).tabIndex).toBe(-1);
    fireEvent.keyDown(auto, { key: "ArrowLeft" });
    await waitFor(() => expect(useCompanionState.getState().presentation.mode).toBe("team"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Team" }));
  });

  it("submits to the displayed agent without binding its conversation to a Space", async () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: { value: "Draft a launch note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
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
      { executionMode: "agent", interactionMode: "team", model: "" },
    );
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe("");
  });
  it("keeps a failed draft available to retry", async () => {
    submit.mockImplementationOnce(async () => {
      useMistyStore.setState({ error: "Connection interrupted" });
    });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Connection interrupted"),
    );
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
      "Keep this draft",
    );
  });
  it("puts a starter into the composer for review before sending", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Plan my next steps" }));
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toContain(
      "practical plan",
    );
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not send to a disabled agent", () => {
    renderWorkspace({ ...agent, enabled: false });
    fireEvent.change(screen.getByLabelText("Message Misty"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Message Misty"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Send to Misty" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
