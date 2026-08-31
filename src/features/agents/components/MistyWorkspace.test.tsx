import { useGlobalSearchStore } from "@/features/global-search/useGlobalSearchStore";
import { useSpacesStore } from "@/features/spaces";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MistyWorkspace } from "./MistyWorkspace";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-a" } }),
}));

const initialState = useGlobalSearchStore.getInitialState();

describe("MistyWorkspace", () => {
  afterEach(() => {
    cleanup();
    useGlobalSearchStore.setState(initialState, true);
    useSpacesStore.setState({ spaces: [] });
  });

  it("submits Enter to the Agent workspace without opening global Search", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    useGlobalSearchStore.setState({
      accountId: "account-a",
      panel: "closed",
      working: false,
      conversationsLoading: false,
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Agent chat",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
      loadConversations: vi.fn().mockResolvedValue(undefined),
      submitAnswer,
    });

    render(
      <MemoryRouter>
        <MistyWorkspace onManageConnections={vi.fn()} />
      </MemoryRouter>,
    );
    const composer = screen.getByRole("textbox", { name: "Message Misty" });

    fireEvent.change(composer, { target: { value: "hello" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(submitAnswer).toHaveBeenCalledWith("hello", undefined, undefined, "workspace");
    expect((composer as HTMLTextAreaElement).value).toBe("");
    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  });

  it("binds the named Space and keeps action requests in the same streamed turn", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    const submitAgentTask = vi.fn().mockResolvedValue(undefined);
    const bindConversationSpace = vi.fn().mockImplementation(async (conversationId, spaceId) => {
      useGlobalSearchStore.setState((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === conversationId ? { ...item, spaceId } : item,
        ),
      }));
    });
    useSpacesStore.setState({
      spaces: [
        {
          id: "family",
          kind: "standard",
          owner_user_id: "account-a",
          name: "Family",
          role: "owner",
          member_count: 4,
          pending_count: 0,
          is_shared: true,
          created_at: "2026-08-25T00:00:00.000Z",
          updated_at: "2026-08-25T00:00:00.000Z",
        },
      ],
    });
    useGlobalSearchStore.setState({
      accountId: "account-a",
      panel: "closed",
      working: false,
      conversationsLoading: false,
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Agent chat",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
      loadConversations: vi.fn().mockResolvedValue(undefined),
      bindConversationSpace,
      submitAnswer,
      submitAgentTask,
    });

    render(
      <MemoryRouter>
        <MistyWorkspace onManageConnections={vi.fn()} />
      </MemoryRouter>,
    );
    const composer = screen.getByRole("textbox", { name: "Message Misty" });

    fireEvent.change(composer, {
      target: { value: "Create a task called Wash dishes inside Family Space" },
    });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => {
      expect(bindConversationSpace).toHaveBeenCalledWith("conversation-a", "family");
      expect(submitAnswer).toHaveBeenCalledWith(
        "Create a task called Wash dishes inside Family Space",
        undefined,
        undefined,
        "workspace",
      );
    });
    expect(submitAgentTask).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Conversation Space: Family" })).not.toBeNull();
  });
});
