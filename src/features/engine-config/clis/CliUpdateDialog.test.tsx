import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliUpdatePlan } from "./api";
import { CliUpdateDialog } from "./CliUpdateDialog";
import type { CliUpdateFlow, CliUpdateFlowState } from "./use_cli_update_flow";

const plan = (canRun: boolean): CliUpdatePlan => ({
  engine: "claude",
  action: "install",
  kind: "native",
  steps: ["curl … | bash"],
  needsHelper: false,
  canRun,
  blockers: canRun ? [] : ["Misty can't install Claude Code here."],
  platform: "macos",
});

function flowAt(state: Partial<CliUpdateFlowState>): CliUpdateFlow {
  return {
    state: {
      status: "ready",
      plan: null,
      error: null,
      runId: null,
      logs: [],
      step: null,
      ...state,
    },
    begin: vi.fn(async () => {}),
    confirm: vi.fn(async () => {}),
    checkAgain: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(cleanup);

describe("CliUpdateDialog in the first-run dialog", () => {
  it("installs at once when the plan can run", () => {
    const flow = flowAt({ plan: plan(true) });
    render(<CliUpdateDialog engine="claude" flow={flow} plain />);
    expect(flow.confirm).toHaveBeenCalledOnce();
  });

  it("waits when the plan can't run", () => {
    const flow = flowAt({ plan: plan(false) });
    render(<CliUpdateDialog engine="claude" flow={flow} plain />);
    expect(flow.confirm).not.toHaveBeenCalled();
  });
});
