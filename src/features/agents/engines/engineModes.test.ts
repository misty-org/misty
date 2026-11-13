import { expect, it } from "vitest";
import { resolveEngineMode, type EngineModeOption } from "./engineModes";

const claude: EngineModeOption[] = [
  { id: "default", label: "Manual", kind: "asks" },
  { id: "acceptEdits", label: "Accept edits", kind: "edits" },
  { id: "plan", label: "Plan", kind: "plans" },
  { id: "bypassPermissions", label: "Bypass permissions", kind: "no_asking" },
];
const kimi: EngineModeOption[] = [
  { id: "default", label: "Default", kind: "asks" },
  { id: "plan", label: "Plan", kind: "plans" },
];
const agy: EngineModeOption[] = [
  { id: "accept-edits", label: "Accept edits", kind: "edits" },
  { id: "plan", label: "Plan", kind: "plans" },
];

it("reads a saved engine mode by its id", () => {
  expect(resolveEngineMode(claude, "acceptEdits")?.label).toBe("Accept edits");
  expect(resolveEngineMode(claude, "plan")?.kind).toBe("plans");
});

it("maps an older Ask, Auto, Plan or Bypass to the engine's own mode", () => {
  expect(resolveEngineMode(claude, "ask")?.id).toBe("default");
  expect(resolveEngineMode(claude, "auto")?.id).toBe("acceptEdits");
  expect(resolveEngineMode(claude, "bypass")?.id).toBe("bypassPermissions");
  // An engine with nothing that works without asking takes the mode that asks.
  expect(resolveEngineMode(kimi, "auto")?.id).toBe("default");
  expect(resolveEngineMode(kimi, "bypass")?.id).toBe("default");
  // An engine that can't ask takes its own first mode for an older Ask.
  expect(resolveEngineMode(agy, "ask")?.id).toBe("accept-edits");
  // Another engine's id, or nothing, asks first.
  expect(resolveEngineMode(kimi, "acceptEdits")?.id).toBe("default");
  expect(resolveEngineMode(claude, undefined)?.id).toBe("default");
});

it("puts a planning chat in the engine's planning mode where it has one", () => {
  expect(resolveEngineMode(claude, "acceptEdits", true)?.id).toBe("plan");
  expect(resolveEngineMode([claude[0]], "auto", true)?.id).toBe("default");
  expect(resolveEngineMode([], "auto")).toBeUndefined();
});
