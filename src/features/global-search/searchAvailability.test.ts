import { afterEach, beforeEach, expect, it } from "vitest";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";
import { useGlobalSearchStore } from "./useGlobalSearchStore";
const reset = () => {
  useLocalExecution.setState({ execution: null });
  useMistyStore.setState({
    panel: "closed",
    executionMode: "user",
    selectedAgentId: "",
    executionModeByAgent: {},
  });
  useGlobalSearchStore.getState().closePanel();
};
beforeEach(reset);
afterEach(reset);
it.each(["openPanel", "activateLauncher", "togglePanel"] as const)(
  "blocks %s in agent mode",
  (entry) => {
    useMistyStore.setState({ panel: "answer", executionMode: "agent" });
    useGlobalSearchStore.getState()[entry]();
    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  },
);
it("blocks search while an agent task is paused even if chat is closed", () => {
  useLocalExecution.setState({
    execution: {
      accountId: "account",
      agentId: "agent",
      spaceId: "space",
      taskId: "task",
      mode: "agent",
      state: "paused",
      views: [],
      context: [],
      deviceContexts: [],
    },
  });
  useGlobalSearchStore.getState().openPanel();
  expect(useGlobalSearchStore.getState().panel).toBe("closed");
});
it("allows search again after leaving the agent overlay", () => {
  useMistyStore.setState({ panel: "closed", executionMode: "agent" });
  useGlobalSearchStore.getState().openPanel();
  expect(useGlobalSearchStore.getState().panel).toBe("results");
});
