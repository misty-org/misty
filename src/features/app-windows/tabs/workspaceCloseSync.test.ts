import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { allLayoutViews } from "../panes/layoutTabs";
import { openPage } from "@/tests/workspacePage";

const state = () => useWorkspaceStore.getState();
beforeEach(() => {
  state().reset();
});

it("closes tabs and remembers them", () => {
  const tab = openPage(state(), { url: "https://example.com" });
  expect(state().closeView(tab.id)).toBe(true);
  expect(allLayoutViews(state().layout).some((item) => item.id === tab.id)).toBe(false);
  expect(state().closedItems[0].view.id).toBe(tab.id);
});
