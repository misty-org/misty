import type { Space } from "@/api/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import { resolveAgentSpaceId, resolveMentionedAgentSpaceId } from "./agentSpaceSelection";

function space(id: string, isDefault = false): Space {
  return {
    id,
    is_default: isDefault,
    owner_user_id: "owner",
    name: id,
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };
}

describe("resolveAgentSpaceId", () => {
  const spaces = [space("personal", true), space("family")];

  it("prefers the default Space when Agents opens without Space context", () => {
    expect(resolveAgentSpaceId(spaces, "tool:agents")).toBe("personal");
  });

  it("preserves an explicit current Space", () => {
    expect(resolveAgentSpaceId(spaces, "space:personal")).toBe("personal");
    expect(resolveAgentSpaceId(spaces, "space:family")).toBe("family");
  });

  it("resolves one explicitly named Space from natural language", () => {
    expect(resolveMentionedAgentSpaceId(spaces, "How many people are in family Space?")).toBe(
      "family",
    );
    expect(resolveMentionedAgentSpaceId(spaces, "Please work in FAMILY.")).toBe("family");
  });

  it("does not guess when no Space or more than one Space matches", () => {
    expect(resolveMentionedAgentSpaceId(spaces, "How many people are there?")).toBe("");
    expect(
      resolveMentionedAgentSpaceId(
        [...spaces, { ...spaces[1], id: "family-two" }],
        "Use family Space",
      ),
    ).toBe("");
  });
});
