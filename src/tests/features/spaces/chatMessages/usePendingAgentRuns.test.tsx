import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePendingAgentRuns } from "@/features/spaces/spaceChat/usePendingAgentRuns";

const TYPING_INDICATOR_DELAY_MS = 900;

type Hook = ReturnType<typeof usePendingAgentRuns>;

let latest: Hook;

function Probe({ spaceId, conversationId }: { spaceId: string; conversationId: string }) {
  latest = usePendingAgentRuns(spaceId, conversationId);
  return <div data-testid="pending">{latest.pending.map((run) => run.triggerId).join(",")}</div>;
}

function runEvent(type: string, payload: Record<string, unknown>, spaceId = "space-1") {
  window.dispatchEvent(
    new CustomEvent("misty:space-agent-run-event", {
      detail: { space_id: spaceId, type, entity_id: payload.trigger_id, payload },
    }),
  );
}

describe("usePendingAgentRuns", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe spaceId="space-1" conversationId="conv-1" />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const pending = () => container.querySelector("[data-testid='pending']")?.textContent;
  const advancePastDelay = async () => {
    await act(async () => {
      vi.advanceTimersByTime(TYPING_INDICATOR_DELAY_MS);
    });
  };

  it("does not show typing the instant a run is sent — there's a short beat first", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
    });

    expect(pending()).toBe("");
  });

  it("shows typing once the delay elapses", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
    });
    await advancePastDelay();

    expect(pending()).toBe("trigger-1");
  });

  it("never shows typing at all when the run finishes inside the delay window", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
    });
    await act(async () => {
      runEvent("agent.run.completed", {
        trigger_id: "trigger-1",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      });
    });
    await advancePastDelay();

    expect(pending()).toBe("");
  });

  it("keeps typing across the working state and stops when the run completes", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
    });
    await advancePastDelay();

    await act(async () => {
      runEvent("agent.run.working", {
        trigger_id: "trigger-1",
        conversation_id: "conv-1",
        run_id: "run-1",
        agent_id: "agent-1",
      });
    });
    await advancePastDelay();
    expect(pending()).toBe("trigger-1");
    // The working event is what supplies the run id the queued state lacks.
    expect(latest.pending[0].runId).toBe("run-1");

    await act(async () => {
      runEvent("agent.run.completed", {
        trigger_id: "trigger-1",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      });
    });
    expect(pending()).toBe("");
  });

  it("stops typing when the run fails", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
    });
    await advancePastDelay();

    await act(async () => {
      runEvent("agent.run.failed", { trigger_id: "trigger-1", conversation_id: "conv-1" });
    });

    expect(pending()).toBe("");
  });

  it("ignores runs belonging to another conversation or Space", async () => {
    await act(async () => {
      runEvent("agent.run.working", { trigger_id: "other-conv", conversation_id: "conv-2" });
      runEvent("agent.run.working", { trigger_id: "other-space", conversation_id: "conv-1" }, "s2");
    });
    await advancePastDelay();

    expect(pending()).toBe("");
  });

  it("does not double-track a run that is both seeded and announced", async () => {
    await act(async () => {
      latest.track([{ id: "trigger-1", agent_id: "agent-1", state: "queued" }]);
      runEvent("agent.run.queued", {
        trigger_id: "trigger-1",
        conversation_id: "conv-1",
        agent_id: "agent-1",
      });
    });
    await advancePastDelay();

    expect(pending()).toBe("trigger-1");
  });
});
