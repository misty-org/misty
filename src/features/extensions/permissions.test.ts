import { describe, expect, it } from "vitest";
import { accessLabels, permissionLabel } from "./permissions";

describe("access in plain words", () => {
  it("says what a host pattern reaches", () => {
    expect(permissionLabel("https://github.com/*")).toBe("Read and change data on github.com");
    expect(permissionLabel("*://*.google.com/*")).toBe(
      "Read and change data on google.com and its subdomains",
    );
    for (const pattern of ["<all_urls>", "*://*/*", "https://*/*"])
      expect(permissionLabel(pattern)).toBe("Read and change data on all websites");
    expect(permissionLabel("file:///*")).toBe("Read files you open from this computer");
  });

  it("keeps an unknown permission's name, so nothing is hidden", () => {
    expect(permissionLabel("somethingNew")).toBe("somethingNew");
  });

  it("shows one line for what means the same, keeping its sources", () => {
    expect(accessLabels(["<all_urls>", "*://*/*", "storage"])).toEqual([
      { label: "Read and change data on all websites", source: "<all_urls>, *://*/*" },
      { label: "Save extension settings", source: "storage" },
    ]);
  });
});
