import { beforeEach, expect, it } from "vitest";
import { useConversationFolder } from "./useConversationFolder";

const store = () => useConversationFolder.getState();

beforeEach(() => {
  useConversationFolder.setState({
    byConversation: {},
    draft: null,
    writes: {},
    draftWrites: null,
  });
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

it("gives write access for one folder in one chat, and only when granted", () => {
  store().setFolder("conversation-a", "scope_docs");
  expect(store().writable("scope_docs", "conversation-a")).toBe(false);
  store().setWritable("conversation-a", "scope_docs", true);
  expect(store().writable("scope_docs", "conversation-a")).toBe(true);
  expect(store().writable("scope_docs", "conversation-b")).toBe(false);
  expect(store().writable("scope_other", "conversation-a")).toBe(false);
});

it("takes write access away when the chat changes folder", () => {
  store().setFolder("conversation-a", "scope_docs");
  store().setWritable("conversation-a", "scope_docs", true);
  store().setFolder("conversation-a", "scope_other");
  expect(store().writable("scope_docs", "conversation-a")).toBe(false);
  expect(store().writable("scope_other", "conversation-a")).toBe(false);
});

it("carries a new chat's write grant to the conversation it becomes", () => {
  store().setFolder(undefined, "scope_docs");
  store().setWritable(undefined, "scope_docs", true);
  store().adoptDraft("conversation-new");
  expect(store().writable("scope_docs", "conversation-new")).toBe(true);
  expect(store().draftWrites).toBeNull();
});

it("forgets write access when a folder stops being shared", () => {
  store().setFolder("conversation-a", "scope_docs");
  store().setWritable("conversation-a", "scope_docs", true);
  store().forget("scope_docs");
  expect(store().writable("scope_docs", "conversation-a")).toBe(false);
});
