import { describe, expect, it } from "vitest";
import type {
  PersonalAgentActivityPage,
  PersonalAgentRunSummary,
} from "./model/interfaces/personal";
import { activityWithOptimisticRetry } from "./useAgentActivity";

describe("optimistic Agent retry activity", () => {
  it("shows the replacement run as queued without waiting for a refetch", () => {
    const failed = {
      run_id: "run-failed",
      agent_id: "agent-1",
      state: "failed",
      source_message_id: "message-1",
      input_modality: "text",
      created_at: "2026-08-18T12:00:00Z",
      updated_at: "2026-08-18T12:00:01Z",
    } as PersonalAgentRunSummary;
    const page = {
      agent_id: "agent-1",
      work_state: "failed",
      queue_count: 0,
      runs: [failed],
    } as PersonalAgentActivityPage;

    const updated = activityWithOptimisticRetry(page, failed.run_id, {
      id: "run-retry",
      state: "queued",
    });

    expect(updated).toMatchObject({
      work_state: "queued",
      queue_count: 1,
      active_run: { run_id: "run-retry", state: "queued", source_message_id: "message-1" },
      runs: [{ run_id: "run-retry", state: "queued" }, { run_id: "run-failed" }],
    });
  });
});
