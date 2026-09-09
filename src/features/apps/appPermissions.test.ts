import { expect, it } from "vitest";
import catalog from "../../../../misty-apps/apps/catalog.json";
import {
  appPermissionGroups,
  appPermissionLabel,
  hasUnknownAppPermissions,
} from "./appPermissions";

it("explains every catalog scope without dropping permissions from grouped consent", () => {
  for (const app of catalog.apps) {
    expect(hasUnknownAppPermissions(app.scopes), app.id).toBe(false);
    expect(
      appPermissionGroups(app.scopes)
        .flatMap((group) => group.scopes)
        .sort(),
    ).toEqual([...app.scopes].sort());
    for (const scope of app.scopes) expect(appPermissionLabel(scope)).not.toBe(scope);
  }
});
it("groups browser and storage access without implying unrequested write access", () => {
  const read = appPermissionGroups(["storage.read"], ["storage.read"])[0];
  expect(read.descriptions.join(" ")).not.toContain("Save");
  expect(read.added).toBe(false);
  const write = appPermissionGroups(["storage.read", "storage.write"], ["storage.read"])[0];
  expect(write.descriptions).toEqual(["Read and save this app’s own settings and data"]);
  expect(write.added).toBe(true);
});
it("does not expose unknown raw identifiers", () => {
  expect(hasUnknownAppPermissions(["future.permission"])).toBe(true);
  expect(appPermissionLabel("future.permission")).not.toContain("future.permission");
});
