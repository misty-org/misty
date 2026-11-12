import { expect, it } from "vitest";
import { chatSpaceId, conversationInSpace, placeUnplacedChats } from "./conversationSpace";

const personal = { key: "personal", spaceId: null, personal: true };
const team = { key: "team", spaceId: "team", personal: false };

it("shows a conversation only in the Space it belongs to", () => {
  const home = { spaceId: "home", personalSpace: true };
  const shared = { spaceId: "team", personalSpace: false };
  expect(conversationInSpace(home, personal)).toBe(true);
  expect(conversationInSpace(home, team)).toBe(false);
  expect(conversationInSpace(shared, personal)).toBe(false);
  expect(conversationInSpace(shared, team)).toBe(true);
});

it("keeps a chat saved without its Space in the personal Space", () => {
  expect(conversationInSpace({}, personal)).toBe(true);
  expect(conversationInSpace({}, team)).toBe(false);
});

it("knows the personal Space's chats by its id once the Spaces load", () => {
  const stamped = { spaceId: "home" };
  expect(conversationInSpace(stamped, personal, "home")).toBe(true);
  expect(conversationInSpace(stamped, personal, null)).toBe(false);
  expect(conversationInSpace(stamped, team, "home")).toBe(false);
});

it("gives chats saved without a Space the personal Space's id, and leaves the rest alone", () => {
  const placed = { spaceId: "team" };
  const old = {};
  const empty = { spaceId: "" };
  const next = placeUnplacedChats([placed, old, empty], "home");
  expect(next[0]).toBe(placed);
  expect(next[1]).toEqual({ spaceId: "home", personalSpace: true });
  expect(next[2]).toEqual({ spaceId: "home", personalSpace: true });
  const settled = [placed];
  expect(placeUnplacedChats(settled, "home")).toBe(settled);
});

it("names the one Space a chat works in, with older and personal chats in the personal Space", () => {
  expect(chatSpaceId({ spaceId: "team" }, "home")).toBe("team");
  expect(chatSpaceId({ spaceId: "home", personalSpace: true }, "home")).toBe("home");
  expect(chatSpaceId({}, "home")).toBe("home");
  expect(chatSpaceId({}, null)).toBe("");
});
