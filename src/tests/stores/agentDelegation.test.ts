import { afterEach, describe, expect, it } from "vitest";
import type { AgentDelegationResult, SpaceRun } from "@/models/interfaces/features/spaces/types";
import {
  clearPendingAgentDelegations,
  hasPendingAgentDelegations,
  agentDelegationMessage,
  publicAgentDisplayName,
  publicAgentModel,
  resolvePendingAgentDelegation,
  trackPendingAgentDelegation,
} from "@/stores/agent/useAgentDelegationStore";
import { initialAgentModelId, initialAgentModelName } from "@/features/agents/modelSelection";

const run = (state: SpaceRun["state"]): SpaceRun => ({
  id: "run_one",
  space_id: "space_one",
  resource_kind: "agent",
  resource_id: "agent_one",
  initiated_by_user_id: "user_one",
  billing_user_id: "user_one",
  trigger_kind: "agent_console",
  state,
  input: { prompt: "Summarize" },
  result: {},
  requesting_member_id: "user_one",
  source_type: "agent_console",
  agent_id: "agent_one",
  progress: 0,
  outputs: {},
  artifacts: [],
  updated_at: "2026-07-17T00:00:00Z",
  created_at: "2026-07-17T00:00:00Z",
});

const result = (state: SpaceRun["state"]): AgentDelegationResult => ({
  status: state,
  trace: "The agent assigned this task to Helper in Personal Space.",
  routing: { needs_clarification: false },
  run: run(state),
});

afterEach(clearPendingAgentDelegations);

describe("Agent Space delegation", () => {
  it("never exposes internal automatic-routing labels", () => {
    expect(publicAgentDisplayName("automatic", "Automatic routing")).toBe(initialAgentModelName);
    expect(publicAgentDisplayName("automatic routing", "")).toBe(initialAgentModelName);
  });

  it("never exposes current internal tier labels", () => {
    expect(publicAgentDisplayName("tier-low", "Tier Low")).toBe(initialAgentModelName);
    expect(publicAgentDisplayName("tier-med", "Tier Med")).toBe(initialAgentModelName);
    expect(publicAgentDisplayName("tier-high", "Tier High")).toBe(initialAgentModelName);
    expect(publicAgentModel("tier-high")).toBe(initialAgentModelId);
  });

  // Sessions persisted before the agent rename still carry "mika-*" labels, and
  // the gateway echoes them back. Masking must keep covering them or the old
  // brand name reappears in the model picker.
  it("never exposes legacy tier labels from pre-rename sessions", () => {
    expect(publicAgentDisplayName("mika-low", "Mika Low")).toBe(initialAgentModelName);
    expect(publicAgentDisplayName("mika-med", "Mika Med")).toBe(initialAgentModelName);
    expect(publicAgentDisplayName("mika-high", "Mika High")).toBe(initialAgentModelName);
    expect(publicAgentModel("mika-high")).toBe(initialAgentModelId);
  });

  it("preserves the selected gateway model name", () => {
    expect(publicAgentModel("xai/grok-4")).toBe("xai/grok-4");
    expect(publicAgentDisplayName("xai/grok-4", "Grok 4")).toBe("Grok 4");
    expect(publicAgentDisplayName("anthropic/claude-sonnet-4", "")).toBe("claude-sonnet-4");
  });

  it("tracks only nonterminal delegated runs until their correlated event arrives", () => {
    expect(trackPendingAgentDelegation(result("awaiting_approval"))).toBe(true);
    expect(hasPendingAgentDelegations()).toBe(true);
    resolvePendingAgentDelegation("run_one");
    expect(hasPendingAgentDelegations()).toBe(false);
    expect(trackPendingAgentDelegation(result("completed"))).toBe(false);
  });

  it("explains clarification choices without inventing a selection", () => {
    expect(
      agentDelegationMessage({
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
