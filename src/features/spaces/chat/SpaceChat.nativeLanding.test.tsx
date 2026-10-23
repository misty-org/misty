import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { spacesApi } from "@/api/spaces/api";
import type { SpacesStore } from "../store/spacesStoreTypes";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceChat } from "./SpaceChat";
import type { SpaceChatThreadProps } from "./components/SpaceChatThread";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/features/ai-surface/AiPaneHost", () => ({ useAiSurfaceAdapter: vi.fn() }));

// Exercise the real landing branch and message scope without the message editor.
vi.mock("./components/SpaceChatThread", () => ({
  SpaceChatThread: ({ scope, onDelete }: SpaceChatThreadProps) => (
    <section aria-label="Conversation messages">
      {scope.messages[0] && (
        <button onClick={() => onDelete(scope.messages[0])}>Request delete</button>
      )}
      {scope.messages.map((message) => (
        <p key={message.id}>
          {message.content.map((span) => (span.type === "text" ? span.text : "")).join("")}
        </p>
      ))}
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows existing Everyone messages when opening Misty without a conversation selection", () => {
  const noop = vi.fn(async () => {});
  const conversations = vi
    .spyOn(spacesApi, "conversations")
    .mockResolvedValue({ conversations: [] } as never);
  vi.spyOn(spacesApi, "libraryItems").mockResolvedValue({ items: [] } as never);
  useSpacesStore.setState({
    spaces: [
      {
        id: "space-a",
        role: "member",
      },
    ],
    referenceOnly: true,
    messagesBySpace: {
      "space-a": [
        {
          id: "message-a",
          content: [{ type: "text", text: "Our earlier Space conversation" }],
          seq: 1,
        },
      ],
    },
    messageLoadingBySpace: {},
    messageErrorsBySpace: {},
    membersBySpace: {},
    nodesBySpace: {},
    agentsBySpace: {},
    presenceBySpace: {},
    loading: false,
    sending: false,
    clearError: noop,
    loadChatAgents: noop,
    loadMembers: noop,
    loadMessages: noop,
    sendMessage: noop,
    updateMessage: noop,
    deleteMessage: noop,
    toggleMessageReaction: noop,
    markRead: noop,
    openNode: noop,
  } as unknown as Partial<SpacesStore>);
  const ui = render(
    <MemoryRouter initialEntries={["/apps/social?provider=misty"]}>
      <SpaceChat spaceId="space-a" spaceName="Our Space" />
    </MemoryRouter>,
  );
  expect(ui.getByRole("heading", { name: "Everyone" })).toBeTruthy();
  expect(ui.getByText("Our earlier Space conversation")).toBeTruthy();
  expect(ui.queryByText("No Misty conversations yet")).toBeNull();
  expect(conversations).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole("button", { name: "Request delete" }));
  expect(ui.getByRole("alertdialog")).toBeTruthy();
  ui.rerender(
    <MemoryRouter initialEntries={["/apps/social?provider=misty"]}>
      <SpaceChat spaceId="space-b" spaceName="Other Space" />
    </MemoryRouter>,
  );
  expect(ui.queryByRole("alertdialog")).toBeNull();
});
