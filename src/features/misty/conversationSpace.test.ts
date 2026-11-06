import { expect, it } from "vitest";
import { conversationInSpace } from "./conversationSpace";

const personal = { key: "personal", spaceId: null, personal: true, incognito: false };
const team = { key: "team", spaceId: "team", personal: false, incognito: false };

it("shows a conversation only in the Space it belongs to", () => {
  const home = { spaceId: "home", personalSpace: true };
  const shared = { spaceId: "team", personalSpace: false };
  expect(conversationInSpace(home, personal)).toBe(true);
  expect(conversationInSpace(home, team)).toBe(false);
  expect(conversationInSpace(shared, personal)).toBe(false);
  expect(conversationInSpace(shared, team)).toBe(true);
});

it("keeps one still being created in the window that made it", () => {
  expect(conversationInSpace({}, team)).toBe(true);
});
