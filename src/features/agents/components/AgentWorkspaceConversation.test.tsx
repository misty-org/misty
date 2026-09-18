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
  });
});
afterEach(cleanup);

describe("Agents workspace conversations", () => {
  it("submits to the displayed agent and Space without opening another panel", async () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Misty"), {
      target: { value: "Draft a launch note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(useMistyStore.getState()).toMatchObject({
      selectedAgentId: "writer",
      selectedSpaceId: "studio",
    });
    expect(submit).toHaveBeenCalledWith("Draft a launch note", [], undefined, "workspace", [], {
      conversationId: "",
      context: [
        expect.objectContaining({ kind: "space", id: "studio", spaceId: "studio", attached: true }),
      ],
    });
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
