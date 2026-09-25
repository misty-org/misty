import { afterEach, expect, it, vi } from "vitest";
import { betaExecutionMode } from "./betaModes";
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
it("keeps companion workers in their own browser on macOS", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  window.history.replaceState(null, "", "/?agent_worker=personal");
  expect(betaExecutionMode("team")).toBe("team");
  expect(betaExecutionMode("user")).toBe("user");
  window.history.replaceState(null, "", "/");
  expect(betaExecutionMode("user")).toBe("agent");
});
