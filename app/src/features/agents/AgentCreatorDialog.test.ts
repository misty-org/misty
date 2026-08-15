import { describe, expect, it } from "vitest";
import { agentSpaceAudienceGrants, composeAgentInstructions } from "./agentCreatorState";

describe("guided Agent creation", () => {
  it("turns personality and communication choices into private core instructions", () => {
    expect(composeAgentInstructions("analytical", "concise", "Surface risks early.")).toBe(
      "Personality: analytical.\n\nCommunication style: concise.\n\nSurface risks early.",
    );
  });

  it("keeps creator-only Space placement restricted to the creator", () => {
    expect(
      agentSpaceAudienceGrants(
        ["space-private", "space-team"],
        { "space-private": "creator_only", "space-team": "all_members" },
        "user-owner",
      ),
    ).toEqual([
      {
        space_id: "space-private",
        all_members: false,
        member_user_ids: ["user-owner"],
      },
      { space_id: "space-team", all_members: true, member_user_ids: [] },
    ]);
  });
});
