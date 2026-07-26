import { beforeEach, describe, expect, it } from "vitest";
import {
  filesAgentScopeKey,
  resetAgentAccountState,
  spaceAgentScopeKey,
  useAgentSessionStore,
} from "@/stores/assistant/useAgentSessionStore";

describe("useAgentSessionStore conversations", () => {
  beforeEach(() => {
    resetAgentAccountState();
  });

  it("starts with a single default conversation", () => {
    const state = useAgentSessionStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
    expect(state.messages).toEqual([]);
  });

  it("starting a new conversation preserves the previous one in the list", async () => {
    const firstId = useAgentSessionStore.getState().activeConversationId;
    useAgentSessionStore.setState({
      messages: [{ id: "m1", role: "user", text: "Hello agent" }],
    });

    await useAgentSessionStore.getState().startNewConversation();

    const state = useAgentSessionStore.getState();
    expect(state.activeConversationId).not.toBe(firstId);
    expect(state.messages).toEqual([]);
    expect(state.conversations).toHaveLength(2);
    const previous = state.conversations.find((conversation) => conversation.id === firstId);
    expect(previous?.title).toBe("Hello agent");
  });

  it("switching back to a previous conversation restores its messages", async () => {
    const firstId = useAgentSessionStore.getState().activeConversationId;
    const firstMessages = [{ id: "m1", role: "user" as const, text: "First chat" }];
    useAgentSessionStore.setState({ messages: firstMessages });

    await useAgentSessionStore.getState().startNewConversation();
    const secondId = useAgentSessionStore.getState().activeConversationId;
    useAgentSessionStore.setState({
      messages: [{ id: "m2", role: "user", text: "Second chat" }],
    });

    await useAgentSessionStore.getState().switchConversation(firstId);
    expect(useAgentSessionStore.getState().messages).toEqual(firstMessages);
    expect(useAgentSessionStore.getState().activeConversationId).toBe(firstId);

    await useAgentSessionStore.getState().switchConversation(secondId);
    expect(useAgentSessionStore.getState().messages).toEqual([
      { id: "m2", role: "user", text: "Second chat" },
    ]);
  });

  it("deleting the active conversation falls back to another conversation", async () => {
    const firstId = useAgentSessionStore.getState().activeConversationId;
    await useAgentSessionStore.getState().startNewConversation();
    const secondId = useAgentSessionStore.getState().activeConversationId;

    await useAgentSessionStore.getState().deleteConversationSession(secondId);

    const state = useAgentSessionStore.getState();
    expect(state.activeConversationId).toBe(firstId);
    expect(state.conversations.some((conversation) => conversation.id === secondId)).toBe(false);
  });

  it("deleting the only conversation starts a fresh one", async () => {
    const onlyId = useAgentSessionStore.getState().activeConversationId;

    await useAgentSessionStore.getState().deleteConversationSession(onlyId);

    const state = useAgentSessionStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).not.toBe(onlyId);
    expect(state.messages).toEqual([]);
  });

  it("isolates Files and Space conversations by both account and Space", async () => {
    const filesMessages = [{ id: "files-message", role: "user" as const, text: "Private file" }];
    useAgentSessionStore.setState({ messages: filesMessages });

    const accountAScope = spaceAgentScopeKey("account/a", "space/shared");
    const accountBScope = spaceAgentScopeKey("account/b", "space/shared");
    expect(accountAScope).not.toBe(accountBScope);

    await useAgentSessionStore.getState().activateConversationScope(accountAScope);
    expect(useAgentSessionStore.getState()).toMatchObject({
      conversationScopeKey: accountAScope,
      messages: [],
    });
    const accountAMessages = [
      { id: "account-a-message", role: "user" as const, text: "Account A secret" },
    ];
    useAgentSessionStore.setState({ messages: accountAMessages });
    const accountAConversationId = useAgentSessionStore.getState().activeConversationId;

    await useAgentSessionStore.getState().activateConversationScope(accountBScope);
    expect(useAgentSessionStore.getState()).toMatchObject({
      conversationScopeKey: accountBScope,
      messages: [],
    });
    const accountBConversationId = useAgentSessionStore.getState().activeConversationId;
    expect(accountBConversationId).not.toBe(accountAConversationId);
    useAgentSessionStore.setState({
      messages: [{ id: "account-b-message", role: "user", text: "Account B secret" }],
    });

    await useAgentSessionStore.getState().activateConversationScope(accountAScope);
    expect(useAgentSessionStore.getState().messages).toEqual(accountAMessages);
    expect(useAgentSessionStore.getState().activeConversationId).toBe(accountAConversationId);

    await useAgentSessionStore.getState().switchConversation(accountBConversationId);
    expect(useAgentSessionStore.getState().activeConversationId).toBe(accountAConversationId);
    expect(useAgentSessionStore.getState().messages).toEqual(accountAMessages);

    await useAgentSessionStore.getState().activateConversationScope(filesAgentScopeKey);
    expect(useAgentSessionStore.getState().messages).toEqual(filesMessages);
  });

  it("drops every scoped conversation when the account state resets", async () => {
    const scope = spaceAgentScopeKey("account-a", "space-a");
    await useAgentSessionStore.getState().activateConversationScope(scope);
    useAgentSessionStore.setState({
      messages: [{ id: "space-message", role: "user", text: "Scoped project context" }],
    });

    resetAgentAccountState();
    expect(useAgentSessionStore.getState()).toMatchObject({
      conversationScopeKey: filesAgentScopeKey,
      messages: [],
    });

    await useAgentSessionStore.getState().activateConversationScope(scope);
    expect(useAgentSessionStore.getState().messages).toEqual([]);
  });
});
