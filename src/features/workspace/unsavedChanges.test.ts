import { expect, it } from "vitest";
import {
  reserveMistyUpdate,
  setWorkspaceUnsaved,
  workspaceViewHasUnsavedChanges,
} from "./unsavedChanges";
it("blocks a Misty update until dirty tabs are saved", () => {
  setWorkspaceUnsaved("dirty", true);
  expect(workspaceViewHasUnsavedChanges("dirty")).toBe(true);
  expect(() => reserveMistyUpdate()).toThrow("Save your changes");
  setWorkspaceUnsaved("dirty", false);
  const release = reserveMistyUpdate();
  expect(() => reserveMistyUpdate()).toThrow("current update");
  release();
  reserveMistyUpdate()();
});
