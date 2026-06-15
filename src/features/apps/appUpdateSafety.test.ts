import { expect, it } from "vitest";
import { retainAppView, assertAppsClosedForUpdate, setAppUnsaved, appViewHasUnsavedChanges } from "./appUpdateSafety";
it("blocks replacement until every mounted view of the app is released", () => {
  const first = retainAppView("code","one"), second = retainAppView("code","two");
  setAppUnsaved("one",true);
  expect(appViewHasUnsavedChanges("one")).toBe(true);
  expect(() => assertAppsClosedForUpdate("code")).toThrow(/Save your work/);
  expect(() => assertAppsClosedForUpdate("files")).not.toThrow();
  first();
  expect(appViewHasUnsavedChanges("one")).toBe(false);
  expect(() => assertAppsClosedForUpdate()).toThrow();
  second();
  expect(() => assertAppsClosedForUpdate()).not.toThrow();
});
