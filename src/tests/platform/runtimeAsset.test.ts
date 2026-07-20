import { describe, expect, it } from "vitest";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import {
  resolveRuntimeAssetReference,
  runtimeAssetReference,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";

describe("runtimeAssetSource", () => {
  it("resolves assets beneath the native Misty assets directory", () => {
    expect(runtimeAssetSource("/Users/misty/.misty/assets/", "/animations/mika.webp")).toBe(
      "/Users/misty/.misty/assets/animations/mika.webp",
    );
  });

  it("does not use a bundled fallback before the native environment is available", () => {
    expect(runtimeAssetSource(undefined, "logos/misty.png")).toBe("");
  });

  it("rejects external and relative runtime asset directories", () => {
    expect(runtimeAssetSource("https://example.invalid/assets", "logos/misty.png")).toBe("");
    expect(runtimeAssetSource("relative/assets", "logos/misty.png")).toBe("");
  });

  it("preserves Windows separators when joining runtime assets", () => {
    expect(runtimeAssetSource("C:\\Users\\misty\\.misty\\assets\\", "logos/misty.png")).toBe(
      "C:\\Users\\misty\\.misty\\assets\\logos\\misty.png",
    );
  });

  it("converts the native Windows asset path through Tauri", () => {
    mockConvertFileSrc("windows");
    try {
      expect(runtimeAssetSource("C:\\Users\\misty\\.misty\\assets", "logos/misty.png")).toBe(
        "http://asset.localhost/C%3A%5CUsers%5Cmisty%5C.misty%5Cassets%5Clogos%5Cmisty.png",
      );
    } finally {
      clearMocks();
    }
  });

  it("resolves deferred icon references after the app snapshot loads", () => {
    expect(
      resolveRuntimeAssetReference(
        runtimeAssetReference("icons/cloud-24.svg"),
        "/Users/misty/.misty/assets",
      ),
    ).toBe("/Users/misty/.misty/assets/icons/cloud-24.svg");
  });
});
