import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliUpdatePlan } from "./api";
import { CliUpdateDialog } from "./CliUpdateDialog";
import type { CliUpdateFlow, CliUpdateFlowState } from "./useCliUpdateFlow";

const plan = (needsDeveloperTools: boolean): CliUpdatePlan => ({
  engine: "hermes",
  action: "install",
  kind: "native",
  steps: needsDeveloperTools ? ["xcode-select --install"] : ["curl … | bash"],
  needsHelper: false,
  needsDeveloperTools,
  canRun: true,
  blockers: [],
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

describe("CliUpdateDialog without Apple's developer tools", () => {
  it("asks for them first, with one button that opens their installer", () => {
    for (const plain of [false, true]) {
      const flow = flowAt({ plan: plan(true) });
      render(<CliUpdateDialog engine="hermes" flow={flow} plain={plain} />);
      expect(screen.getByText("This needs Apple's developer tools first.")).toBeTruthy();
      // The first-run dialog doesn't start anything on its own here.
      expect(flow.confirm).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Install developer tools" }));
      expect(flow.confirm).toHaveBeenCalledOnce();
      cleanup();
    }
  });

  it("continues to the install once Apple's installer is open", () => {
    const flow = flowAt({ status: "done", plan: plan(true) });
    render(<CliUpdateDialog engine="hermes" flow={flow} plain />);
    expect(screen.getByText(/Apple's installer is open/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(flow.begin).toHaveBeenCalledOnce();
  });

  it("installs at once in the first-run dialog when the tools are there", () => {
    const flow = flowAt({ plan: plan(false) });
    render(<CliUpdateDialog engine="hermes" flow={flow} plain />);
    expect(flow.confirm).toHaveBeenCalledOnce();
    expect(screen.queryByText("This needs Apple's developer tools first.")).toBeNull();
  });
});
