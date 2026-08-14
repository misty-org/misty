import type { WorkspaceView } from "@/features/workspace";
import { expect, it } from "vitest";
import { workspaceTabDropIndex } from "./WorkspaceViewGroupButton";

it("computes grouped drop positions in pane order and adjusts for same-pane removal", () => {
  const paneTabs = ["one", "two", "three", "four"].map((id) => ({ id }) as WorkspaceView);
  expect(workspaceTabDropIndex(paneTabs, "one", "four")).toBe(2);
  expect(workspaceTabDropIndex(paneTabs, "four", "two")).toBe(1);
  expect(workspaceTabDropIndex(paneTabs, "external", "three")).toBe(2);
});
