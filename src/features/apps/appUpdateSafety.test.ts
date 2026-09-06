import { expect, it } from "vitest";
import { retainAppView, assertAppsClosedForUpdate, setAppUnsaved, appViewHasUnsavedChanges, reserveAppUpdate } from "./appUpdateSafety";
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

it("prevents opening new work throughout app and host installation",()=>{
  const finish = reserveAppUpdate("code");
  expect(()=>retainAppView("code","during-update")).toThrow(/being installed/);
  const files = retainAppView("files","other-app"); files();
  expect(()=>reserveAppUpdate()).toThrow(/current update/);
  finish();
  const finishHost = reserveAppUpdate();
  expect(()=>retainAppView("files","during-host-update")).toThrow(/being installed/);
  finishHost();
  retainAppView("code","after-update")();
});
it("keeps dirty state while another mount owns the same view",()=>{
  const first=retainAppView("code","shared"),second=retainAppView("code","shared");
  setAppUnsaved("shared",true);first();
  expect(appViewHasUnsavedChanges("shared")).toBe(true);second();
  expect(appViewHasUnsavedChanges("shared")).toBe(false);
});
