import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  setState: vi.fn(),
  state: {
    executionMode: "team",
    working: true,
    accountId: "owner",
    selectedAgentId: "agent",
    error: null,
  },
}));
vi.mock("../agentWindowHandoff", () => ({ showAgentWindow: mocks.show }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    {
      getState: () => mocks.state,
      setState: mocks.setState,
    },
  ),
}));
import { AgentControlBar } from "./AgentControlBar";

it("offers no work-location choice", () => {
  render(<AgentControlBar />);
  expect(
    screen.queryByRole("button", { name: /this conversation|control this screen/i }),
  ).toBeNull();
});

it("keeps an early Show window notice local without interrupting task admission", async () => {
  mocks.show.mockRejectedValue(
    new Error("Agent window: No agent window is open. Start a separate-window task first."),
  );
  render(<AgentControlBar />);
  fireEvent.click(screen.getAllByRole("button", { name: "Show agent window" })[0]);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("once the task starts"),
  );
  expect(mocks.show).toHaveBeenCalledWith("owner", "agent");
  expect(mocks.setState).not.toHaveBeenCalled();
  expect(mocks.state.error).toBeNull();
});
