import type { Space } from "@/api/spaces/dto/interfaces/types";
import { describe, expect, it } from "vitest";
import { resolveAgentSpaceId } from "./agentSpaceSelection";

function space(id: string, kind: "standard" | "misty"): Space {
  return {
    id,
    kind,
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
  const spaces = [space("misty", "misty"), space("family", "standard")];

  it("prefers a normal Space when Agents opens without Space context", () => {
    expect(resolveAgentSpaceId(spaces, "tool:agents")).toBe("family");
  });

  it("preserves an explicit current Space, including Misty", () => {
    expect(resolveAgentSpaceId(spaces, "space:misty")).toBe("misty");
    expect(resolveAgentSpaceId(spaces, "space:family")).toBe("family");
  });
});
