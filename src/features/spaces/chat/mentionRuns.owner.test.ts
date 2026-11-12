import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createInvocation: vi.fn() }));

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/spaces/api/api", () => ({
  spacesApi: { sendMessage: async () => ({}) },
}));
vi.mock("@/features/agents/personal/deviceGrants", () => ({ desktopDeviceGrants: async () => [] }));
vi.mock("@/features/agents/personal/personalAgentsApi", () => ({
  listPersonalAgents: async () => [{ id: "builder", name: "Builder", enabled: true }],
}));
vi.mock("@/features/agents/runs/invocations/api", () => ({
  aiSurfaceApi: { createInvocation: mocks.createInvocation },
  subscribeToAiInvocation: vi.fn(),
}));

import type { SpaceMessage } from "../api/dto/entities";
import { runOwnMentions } from "./mentionRuns";

const message = (sender: string, agentId: string) =>
  ({
    id: "m1",
    space_id: "s1",
    sender_user_id: sender,
    content: [{ type: "mention", agent_id: agentId, label: "Builder" }],
  }) as unknown as SpaceMessage;

beforeEach(() => {
  mocks.createInvocation.mockReset().mockRejectedValue(new Error("stop"));
});

const settle = () => new Promise((done) => setTimeout(done, 0));

it("runs the person's own agent from their own message, in that Space", async () => {
  runOwnMentions(
    message("me", "builder"),
    [{ agent_id: "builder", agent_name: "Builder", owner_user_id: "me" }],
    "me",
  );
  await settle();
  expect(mocks.createInvocation).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "builder", spaceId: "s1" }),
  );
});

it("never runs anything for a message someone else sent", async () => {
  runOwnMentions(
    message("bob", "builder"),
    [{ agent_id: "builder", agent_name: "Builder", owner_user_id: "me" }],
    "me",
  );
  await settle();
  expect(mocks.createInvocation).not.toHaveBeenCalled();
});

it("never runs a friend's agent, even one named like the person's own", async () => {
  runOwnMentions(
    message("me", "bobs-builder"),
    [{ agent_id: "bobs-builder", agent_name: "Builder", owner_user_id: "bob" }],
    "me",
  );
  runOwnMentions(
    message("me", "bobs-builder"),
    [{ agent_id: "bobs-builder", agent_name: "Builder", owner_user_id: "me" }],
    "me",
  );
  await settle();
  expect(mocks.createInvocation).not.toHaveBeenCalled();
});
