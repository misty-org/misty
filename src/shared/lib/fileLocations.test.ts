import { describe, expect, it } from "vitest";
import { isRetiredCloudLocation } from "./fileLocations";

describe("Files locations", () => {
  it.each([
    "/Users/me/Documents",
    "C:\\Users\\me\\Documents",
    "\\\\nas\\photos",
    "/Volumes/NAS/photos",
    "misty://device/laptop/docs/report.pdf",
    "misty://recent",
  ])("preserves local and LAN paths: %s", (path) => {
    expect(isRetiredCloudLocation(path)).toBe(false);
  });
  it.each([
    "misty-remotes://manage",
    "misty://drive-work/Reports",
    "https://drive.google.com/file",
    "/Users/me/.misty/mnt/drive/Reports",
  ])("rejects retired provider locations: %s", (path) => {
    expect(isRetiredCloudLocation(path)).toBe(true);
  });
  it("matches the configured legacy mount on directory boundaries", () => {
    expect(isRetiredCloudLocation("/cloud/work/file", "/cloud")).toBe(true);
    expect(isRetiredCloudLocation("/cloud-projects/file", "/cloud")).toBe(false);
  });
});
