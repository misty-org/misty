import { expect, it } from "vitest";
import { groupGrants, lastUsedText, type AgentGrant } from "./api";

const grant = (overrides: Partial<AgentGrant>): AgentGrant => ({
  id: "grant_1",
  agent_id: "agent_b",
  agent_name: "Builder",
  action: "git.push",
  scope_kind: "repo",
  scope_id: "misty-org/misty",
  label: "Push to misty-org/misty",
  created_at: "2026-10-01T00:00:00Z",
  use_count: 0,
  ...overrides,
});

it("groups grants by agent in name order", () => {
  const groups = groupGrants([
    grant({ id: "g1" }),
    grant({ id: "g2", agent_id: "agent_a", agent_name: "Assistant" }),
    grant({ id: "g3" }),
  ]);
  expect(groups.map((group) => group.agentName)).toEqual(["Assistant", "Builder"]);
  expect(groups[1]?.grants.map((item) => item.id)).toEqual(["g1", "g3"]);
});

it("describes when a grant was last used", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  expect(lastUsedText({}, now)).toBe("Not used yet");
  expect(lastUsedText({ last_used_at: "2026-10-10T08:00:00Z" }, now)).toBe("Last used today");
  expect(lastUsedText({ last_used_at: "2026-10-09T08:00:00Z" }, now)).toBe("Last used yesterday");
  expect(lastUsedText({ last_used_at: "2026-10-01T08:00:00Z" }, now)).toBe("Last used 9 days ago");
});
