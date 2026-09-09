import { beforeEach, expect, it } from "vitest";
import { useConversationProject } from "./useConversationProject";

const store = () => useConversationProject.getState();

beforeEach(() => {
  useConversationProject.setState({ byConversation: {}, draft: null });
});

it("keeps a project per conversation, none by default", () => {
  expect(store().project("conversation-a")).toBeNull();
  store().setProject("conversation-a", "scope_site");
  expect(store().project("conversation-a")).toBe("scope_site");
  expect(store().project("conversation-b")).toBeNull();
  store().setProject("conversation-a", null);
  expect(store().project("conversation-a")).toBeNull();
});

it("gives a new chat's choice to the conversation it becomes", () => {
  store().setProject(undefined, "scope_site");
  expect(store().project(undefined)).toBe("scope_site");
  store().adoptDraft("conversation-new");
  expect(store().project("conversation-new")).toBe("scope_site");
  expect(store().draft).toBeNull();
});

it("forgets a removed project everywhere", () => {
  store().setProject("conversation-a", "scope_site");
  store().setProject(undefined, "scope_site");
  store().forget("scope_site");
  expect(store().project("conversation-a")).toBeNull();
  expect(store().draft).toBeNull();
});
