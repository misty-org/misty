import { describe, expect, it } from "vitest";
import { appBundleUrl } from "./appUrl";

describe("appBundleUrl", () => {
  it("names the app, its version and a file, on the app's own origin", () => {
    expect(appBundleUrl("photocraft", "1.2.0")).toMatch(
      /^(misty-app:\/\/photocraft\/1\.2\.0\/|http:\/\/misty-app\.localhost\/photocraft\/1\.2\.0\/)$/,
    );
    expect(appBundleUrl("deckcraft", "0.9.0", "assets/a b.js")).toMatch(
      /\/deckcraft\/0\.9\.0\/assets\/a%20b\.js$/,
    );
  });

  it("keeps a hostile id or file from adding path parts or climbing out", () => {
    expect(appBundleUrl("a/b", "1", "../x")).toMatch(/\/a%2Fb\/1\/x$/);
  });
});
