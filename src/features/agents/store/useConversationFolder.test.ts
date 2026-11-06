import { beforeEach, expect, it } from "vitest";
import { useConversationFolder } from "./useConversationFolder";

const store = () => useConversationFolder.getState();

beforeEach(() => {
  useConversationFolder.setState({ byConversation: {}, draft: null });
});

it("keeps a folder per conversation, none by default", () => {
  expect(store().folder("conversation-a")).toBeNull();
  store().setFolder("conversation-a", "scope_docs");
  expect(store().folder("conversation-a")).toBe("scope_docs");
  expect(store().folder("conversation-b")).toBeNull();
  store().setFolder("conversation-a", null);
  expect(store().folder("conversation-a")).toBeNull();
});

it("gives a new chat's choice to the conversation it becomes", () => {
  store().setFolder(undefined, "scope_docs");
  expect(store().folder(undefined)).toBe("scope_docs");
  store().adoptDraft("conversation-new");
  expect(store().folder("conversation-new")).toBe("scope_docs");
  expect(store().draft).toBeNull();
});

it("forgets a folder everywhere when it stops being shared", () => {
  store().setFolder("conversation-a", "scope_docs");
  store().setFolder(undefined, "scope_docs");
  store().forget("scope_docs");
  expect(store().folder("conversation-a")).toBeNull();
  expect(store().draft).toBeNull();
});
