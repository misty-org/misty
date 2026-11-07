import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../agentAccount", () => ({ agentAccountId: () => "the-account" }));

import { runStateAccount, setRunStateAccount } from "./documents";

afterEach(() => setRunStateAccount(""));

it("knows the account with no chat panel open, for a run resumed after a reload", () => {
  expect(runStateAccount()).toBe("the-account");
});

it("uses the account of the chat that opened", () => {
  setRunStateAccount("the-chats-account");
  expect(runStateAccount()).toBe("the-chats-account");
});
