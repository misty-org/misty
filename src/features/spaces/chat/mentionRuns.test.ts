import { expect, it, vi } from "vitest";

vi.mock("@/api/spaces/api", () => ({ spacesApi: {} }));
vi.mock("@/features/agents/deviceGrants", () => ({ desktopDeviceGrants: async () => [] }));
vi.mock("@/features/agents/personalAgentsApi", () => ({ listPersonalAgents: async () => [] }));
vi.mock("@/features/ai-surface/api", () => ({ aiSurfaceApi: {}, subscribeToAiInvocation: vi.fn() }));

import { ownMentions } from "./mentionRuns";

const agent = (id: string, owner: string) => ({
  agent_id: id,
  agent_name: id,
  owner_user_id: owner,
});
const mention = (agent_id: string) => ({ type: "mention", agent_id, label: agent_id }) as never;

it("runs only the sender's own agents, each once, at most three", () => {
  const agents = ["a", "b", "c", "d"].map((id) => agent(id, "me"));
  expect(
    ownMentions([mention("a"), mention("a"), mention("b")], agents, "me").map((item) => item.agent_id),
  ).toEqual(["a", "b"]);
  expect(
    ownMentions(["a", "b", "c", "d"].map(mention), agents, "me").map((item) => item.agent_id),
  ).toEqual(["a", "b", "c"]);
});

it("treats someone else's agent as text", () => {
  expect(ownMentions([mention("theirs")], [agent("theirs", "bob")], "me")).toEqual([]);
  expect(ownMentions([{ type: "text", text: "hi" } as never], [agent("a", "me")], "me")).toEqual([]);
});
