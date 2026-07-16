import { describe, expect, it } from "vitest";
import {
  resolveRuntimeAssetReference,
  runtimeAssetReference,
  runtimeAssetSource,
} from "./runtimeAsset";

describe("runtimeAssetSource", () => {
  it("resolves assets beneath the native Misty assets directory", () => {
    expect(runtimeAssetSource(
      "/Users/misty/.misty/assets/",
      "/animations/mika.webp",
      "/bundled/mika.webp",
    )).toBe("/Users/misty/.misty/assets/animations/mika.webp");
  });

  it("uses the bundled asset until the native environment is available", () => {
    expect(runtimeAssetSource(undefined, "logos/misty.png", "/bundled/misty.png"))
      .toBe("/bundled/misty.png");
  });

  it("rejects external and relative runtime asset directories", () => {
    expect(runtimeAssetSource("https://example.invalid/assets", "logos/misty.png", "/bundled/misty.png"))
      .toBe("/bundled/misty.png");
    expect(runtimeAssetSource("relative/assets", "logos/misty.png", "/bundled/misty.png"))
      .toBe("/bundled/misty.png");
  });

  it("resolves deferred icon references after the app snapshot loads", () => {
    expect(resolveRuntimeAssetReference(
      runtimeAssetReference("icons/cloud-24.svg"),
      "/Users/misty/.misty/assets",
    )).toBe("/Users/misty/.misty/assets/icons/cloud-24.svg");
  });
});
