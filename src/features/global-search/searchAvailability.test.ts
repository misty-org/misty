import { afterEach, beforeEach, expect, it } from "vitest";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";
import { useGlobalSearchStore } from "./useGlobalSearchStore";
const reset = () => {
  useLocalExecution.setState({ execution: null });
  useMistyStore.setState({
    panel: "closed",
    executionMode: "user",
    working: false,
    selectedAgentId: "",
  });
  useGlobalSearchStore.getState().closePanel();
};
beforeEach(reset);
afterEach(reset);
it.each(["openPanel", "activateLauncher", "togglePanel"] as const)(
  "blocks %s while a screen task runs",
  (entry) => {
    useMistyStore.setState({ panel: "answer", executionMode: "agent", working: true });
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
  useMistyStore.setState({ panel: "closed", executionMode: "agent", working: true });
  useGlobalSearchStore.getState().openPanel();
  expect(useGlobalSearchStore.getState().panel).toBe("results");
});
it("keeps search available once a screen task finishes", () => {
  useMistyStore.setState({ panel: "answer", executionMode: "agent", working: false });
  useGlobalSearchStore.getState().openPanel();
  expect(useGlobalSearchStore.getState().panel).toBe("results");
});
