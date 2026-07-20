import { afterEach, describe, expect, it } from "vitest";
import type { MikaDelegationResult, SpaceRun } from "@/models/interfaces/features/spaces/types";
import {
  clearPendingMikaDelegations,
  hasPendingMikaDelegations,
  mikaDelegationMessage,
  resolvePendingMikaDelegation,
  trackPendingMikaDelegation,
} from "@/stores/assistant/useMikaDelegationStore";

const run = (state: SpaceRun["state"]): SpaceRun => ({
  id: "run_one",
  space_id: "space_one",
  resource_kind: "agent",
  resource_id: "agent_one",
  initiated_by_user_id: "user_one",
  billing_user_id: "user_one",
  trigger_kind: "mika",
  state,
  input: { prompt: "Summarize" },
  result: {},
  requesting_member_id: "user_one",
  source_type: "mika",
  agent_id: "agent_one",
  progress: 0,
  outputs: {},
  artifacts: [],
  updated_at: "2026-07-17T00:00:00Z",
  created_at: "2026-07-17T00:00:00Z",
});

const result = (state: SpaceRun["state"]): MikaDelegationResult => ({
  status: state,
  trace: "Mika assigned this task to Helper in Personal Space.",
  routing: { needs_clarification: false },
  run: run(state),
});

afterEach(clearPendingMikaDelegations);

describe("Mika Space delegation", () => {
  it("tracks only nonterminal delegated runs until their correlated event arrives", () => {
    expect(trackPendingMikaDelegation(result("awaiting_approval"))).toBe(true);
    expect(hasPendingMikaDelegations()).toBe(true);
    resolvePendingMikaDelegation("run_one");
    expect(hasPendingMikaDelegations()).toBe(false);
    expect(trackPendingMikaDelegation(result("completed"))).toBe(false);
  });

  it("explains clarification choices without inventing a selection", () => {
    expect(
      mikaDelegationMessage({
        status: "needs_clarification",
        routing: {
          needs_clarification: true,
          question: "Which Agent should handle this?",
          options: [
            {
              space_id: "space_one",
              space_name: "Personal Space",
              agent_id: "agent_one",
              agent_name: "Helper",
              capability_id: "summarize",
              capability_name: "Summarize",
            },
          ],
        },
      }),
    ).toBe("Which Agent should handle this?\n• Helper in Personal Space (Summarize)");
  });
});
