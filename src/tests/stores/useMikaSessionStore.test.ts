import { beforeEach, describe, expect, it } from "vitest";
import {
  filesMikaScopeKey,
  resetMikaAccountState,
  spaceMikaScopeKey,
  useMikaSessionStore,
} from "@/stores/assistant/useMikaSessionStore";

describe("useMikaSessionStore conversations", () => {
  beforeEach(() => {
    resetMikaAccountState();
  });

  it("starts with a single default conversation", () => {
    const state = useMikaSessionStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
    expect(state.messages).toEqual([]);
  });

  it("starting a new conversation preserves the previous one in the list", async () => {
    const firstId = useMikaSessionStore.getState().activeConversationId;
    useMikaSessionStore.setState({
      messages: [{ id: "m1", role: "user", text: "Hello Mika" }],
    });

    await useMikaSessionStore.getState().startNewConversation();

    const state = useMikaSessionStore.getState();
    expect(state.activeConversationId).not.toBe(firstId);
    expect(state.messages).toEqual([]);
    expect(state.conversations).toHaveLength(2);
    const previous = state.conversations.find((conversation) => conversation.id === firstId);
    expect(previous?.title).toBe("Hello Mika");
  });

  it("switching back to a previous conversation restores its messages", async () => {
    const firstId = useMikaSessionStore.getState().activeConversationId;
    const firstMessages = [{ id: "m1", role: "user" as const, text: "First chat" }];
    useMikaSessionStore.setState({ messages: firstMessages });

    await useMikaSessionStore.getState().startNewConversation();
    const secondId = useMikaSessionStore.getState().activeConversationId;
    useMikaSessionStore.setState({
      messages: [{ id: "m2", role: "user", text: "Second chat" }],
    });

    await useMikaSessionStore.getState().switchConversation(firstId);
    expect(useMikaSessionStore.getState().messages).toEqual(firstMessages);
    expect(useMikaSessionStore.getState().activeConversationId).toBe(firstId);

    await useMikaSessionStore.getState().switchConversation(secondId);
    expect(useMikaSessionStore.getState().messages).toEqual([
      { id: "m2", role: "user", text: "Second chat" },
    ]);
  });

  it("deleting the active conversation falls back to another conversation", async () => {
    const firstId = useMikaSessionStore.getState().activeConversationId;
    await useMikaSessionStore.getState().startNewConversation();
    const secondId = useMikaSessionStore.getState().activeConversationId;

    await useMikaSessionStore.getState().deleteConversationSession(secondId);

    const state = useMikaSessionStore.getState();
    expect(state.activeConversationId).toBe(firstId);
    expect(state.conversations.some((conversation) => conversation.id === secondId)).toBe(false);
  });

  it("deleting the only conversation starts a fresh one", async () => {
    const onlyId = useMikaSessionStore.getState().activeConversationId;

    await useMikaSessionStore.getState().deleteConversationSession(onlyId);

    const state = useMikaSessionStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).not.toBe(onlyId);
    expect(state.messages).toEqual([]);
  });

  it("isolates Files and Space conversations by both account and Space", async () => {
    const filesMessages = [{ id: "files-message", role: "user" as const, text: "Private file" }];
    useMikaSessionStore.setState({ messages: filesMessages });

    const accountAScope = spaceMikaScopeKey("account/a", "space/shared");
    const accountBScope = spaceMikaScopeKey("account/b", "space/shared");
    expect(accountAScope).not.toBe(accountBScope);

    await useMikaSessionStore.getState().activateConversationScope(accountAScope);
    expect(useMikaSessionStore.getState()).toMatchObject({
      conversationScopeKey: accountAScope,
      messages: [],
    });
    const accountAMessages = [
      { id: "account-a-message", role: "user" as const, text: "Account A secret" },
    ];
    useMikaSessionStore.setState({ messages: accountAMessages });
    const accountAConversationId = useMikaSessionStore.getState().activeConversationId;

    await useMikaSessionStore.getState().activateConversationScope(accountBScope);
    expect(useMikaSessionStore.getState()).toMatchObject({
      conversationScopeKey: accountBScope,
      messages: [],
    });
    const accountBConversationId = useMikaSessionStore.getState().activeConversationId;
    expect(accountBConversationId).not.toBe(accountAConversationId);
    useMikaSessionStore.setState({
      messages: [{ id: "account-b-message", role: "user", text: "Account B secret" }],
    });

    await useMikaSessionStore.getState().activateConversationScope(accountAScope);
    expect(useMikaSessionStore.getState().messages).toEqual(accountAMessages);
    expect(useMikaSessionStore.getState().activeConversationId).toBe(accountAConversationId);

    await useMikaSessionStore.getState().switchConversation(accountBConversationId);
    expect(useMikaSessionStore.getState().activeConversationId).toBe(accountAConversationId);
    expect(useMikaSessionStore.getState().messages).toEqual(accountAMessages);

    await useMikaSessionStore.getState().activateConversationScope(filesMikaScopeKey);
    expect(useMikaSessionStore.getState().messages).toEqual(filesMessages);
  });

  it("drops every scoped conversation when the account state resets", async () => {
    const scope = spaceMikaScopeKey("account-a", "space-a");
    await useMikaSessionStore.getState().activateConversationScope(scope);
    useMikaSessionStore.setState({
      messages: [{ id: "space-message", role: "user", text: "Scoped project context" }],
    });

    resetMikaAccountState();
    expect(useMikaSessionStore.getState()).toMatchObject({
      conversationScopeKey: filesMikaScopeKey,
      messages: [],
    });

    await useMikaSessionStore.getState().activateConversationScope(scope);
    expect(useMikaSessionStore.getState().messages).toEqual([]);
  });
});
