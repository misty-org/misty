import type { RoadmapRuntime } from "./roadmapRuntime";

/** Explicit test runtime: an unexpected data operation fails, never uses a real account. */
export function roadmapTestRuntime(overrides: Partial<RoadmapRuntime["api"]> = {}): RoadmapRuntime {
  return {
    api: new Proxy(overrides, {
      get(target, name) {
        return (
          target[name as keyof typeof target] ??
          (() => {
            throw new Error(`Unexpected test operation: ${String(name)}`);
          })
        );
      },
    }) as RoadmapRuntime["api"],
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
