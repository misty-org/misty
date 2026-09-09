import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { create } from "zustand";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceSocial } from "./SpaceChat";
import { configureSocialRuntime, type SocialRuntime } from "./socialRuntime";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import type { SpaceChatThreadProps } from "./components/SpaceChatThread";

// Exercise the real landing branch and message scope without the message editor.
vi.mock("./components/SpaceChatThread", () => ({
  SpaceChatThread: ({ scope }: SpaceChatThreadProps) => (
    <section aria-label="Conversation messages">
      {scope.messages.map((message) => (
        <p key={message.id}>
          {message.content.map((span) => (span.type === "text" ? span.text : "")).join("")}
        </p>
      ))}
    </section>
  ),
}));

let release: (() => void) | undefined;
afterEach(() => {
  cleanup();
  release?.();
});

it("shows existing Everyone messages when opening Misty without a conversation selection", () => {
  const noop = vi.fn(async () => {});
  const conversations = vi.fn(async () => ({ conversations: [] }));
  const spaces = create(() => ({
    spaces: [
      {
        id: "space-a",
        role: "member",
        permissions: { "messages.write": false, "library.view": false },
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
  }));
  release = configureSocialRuntime({
    events: new EventTarget(),
    api: { conversations, actionSuggestions: async () => ({ suggestions: [] }) },
    useSpacesStore: spaces,
    useAuth: () => ({ user: { id: "viewer" } }),
    useSetupStore: create(() => ({ status: null })),
    useConnectionsStore: create(() => ({
      connections: [],
      loading: false,
      setAccount: noop,
      load: noop,
      beginAuthorization: noop,
      clearError: noop,
    })),
    useAiSurfaceAdapter: noop,
    useWorkspaceTabTitle: noop,
    useSpaceChatDraft,
  } as unknown as SocialRuntime);
  const ui = render(
    <MemoryRouter initialEntries={["/apps/social?provider=misty"]}>
      <SpaceSocial spaceId="space-a" spaceName="Our Space" provider="misty" />
    </MemoryRouter>,
  );
  expect(ui.getByRole("heading", { name: "Everyone" })).toBeTruthy();
  expect(ui.getByText("Our earlier Space conversation")).toBeTruthy();
  expect(ui.queryByText("No Misty conversations yet")).toBeNull();
  expect(conversations).not.toHaveBeenCalled();
});
