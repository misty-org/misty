import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiArtifact } from "@/features/ai-surface/types";
const fixture = vi.hoisted(() => ({
  decide: vi.fn(),
  state: {} as Record<string, unknown>,
}));
vi.mock("./useMistyStore", () => ({
  useMistyStore: Object.assign((select: (state: unknown) => unknown) => select(fixture.state), {
    getState: () => fixture.state,
    setState: vi.fn(),
  }),
}));
vi.mock("@/features/agents/AgentsRuntime", () => ({
  runtimeAiApi: { decideArtifact: fixture.decide },
}));
vi.mock("./contextBridge", () => ({ requestHostContext: vi.fn() }));
vi.mock("./availability", () => ({ assertMistyAvailable: vi.fn() }));
import { MistyContextBar } from "./MistyContextBar";
beforeEach(() => {
  fixture.decide.mockReset().mockResolvedValue({});
  fixture.state = {
    conversations: [],
    artifactPaneId: "removed-pane",
    accountId: "owner",
    activeConversationId: "task",
    artifactConversationId: "task",
    pendingArtifact: {
      id: "proposal",
      kind: "text_patch",
      title: "Edit notes",
      summary: "Review one change.",
      operations: { changes: 1 },
    } as unknown as AiArtifact,
  };
});
afterEach(cleanup);

it("can reject a proposal after its original pane was removed", async () => {
  render(<MistyContextBar />);
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  await waitFor(() =>
    expect(fixture.decide).toHaveBeenCalledWith("proposal", "reject", "misty-proposal-reject"),
  );
});
