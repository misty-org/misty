import { expect, it } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { isTrustedHostApp } from "./trustedHostApps";

const planner = {
  id: "planner",
  app_id: "com.misty.planner",
  publisher: "Misty",
  official: true,
} as OfficialApp;
it("selects only compiled host modules with their exact catalog identity", () => {
  expect(isTrustedHostApp(planner)).toBe(true);
});
it.each([
  { id: "custom" },
  { id: "__proto__" },
  { id: "constructor" },
  { app_id: "third.party.planner" },
  { app_id: undefined },
  { official: false },
  { publisher: "Another publisher" },
])("does not promote a package to host trust: %j", (change) => {
  expect(isTrustedHostApp({ ...planner, ...change } as OfficialApp)).toBe(false);
});
