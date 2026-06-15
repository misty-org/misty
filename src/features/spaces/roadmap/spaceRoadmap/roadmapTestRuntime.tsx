import { createMistyAppSDK } from "@misty/sdk";
import { createSDKTaskServices } from "../../planner/spaceTasks/taskServices";
import { createSDKRoadmapServices } from "./roadmapServices";
import type { RoadmapRuntime } from "./roadmapRuntime";

/** Explicit test runtime: an unexpected data operation fails, never uses a real account. */
export function roadmapTestRuntime(overrides: Partial<RoadmapRuntime["api"]> = {}): RoadmapRuntime {
  const misty = createMistyAppSDK({
    request: async ({ method }) => {
      if (method !== "lifecycle.ready") throw new Error(`Unexpected test request: ${method}`);
    },
  });
  return {
    api: { ...createSDKTaskServices(misty), ...createSDKRoadmapServices(misty), ...overrides },
    userId: "user-1",
    focused: true,
    theme: "dark",
    storage: window.localStorage,
    shortcutLabels: {},
    registerCommand: () => () => {},
    subscribeChanges: () => () => {},
    renderIntegration: () => null,
    renderError: (message) => <div role="alert">{message}</div>,
  };
}
