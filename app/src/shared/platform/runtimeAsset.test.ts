import {
  resolveRuntimeAssetReference,
  runtimeAssetReference,
  runtimeAssetSource,
} from "@/shared/platform/runtimeAsset";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";

describe("runtimeAssetSource", () => {
  it("resolves assets beneath the native Misty assets directory", () => {
    expect(runtimeAssetSource("/Users/misty/.misty/assets/", "/logos/misty-white.png")).toBe(
      "/Users/misty/.misty/assets/logos/misty-white.png",
    );
  });

  it("does not use a bundled fallback before the native environment is available", () => {
    expect(runtimeAssetSource(undefined, "logos/misty-black.png")).toBe("");
  });

  it("rejects external and relative runtime asset directories", () => {
    expect(runtimeAssetSource("https://example.invalid/assets", "logos/misty-black.png")).toBe("");
    expect(runtimeAssetSource("relative/assets", "logos/misty-black.png")).toBe("");
  });

  it("preserves Windows separators when joining runtime assets", () => {
    expect(runtimeAssetSource("C:\\Users\\misty\\.misty\\assets\\", "logos/misty-black.png")).toBe(
      "C:\\Users\\misty\\.misty\\assets\\logos\\misty-black.png",
    );
  });

  it("converts the native Windows asset path through Tauri", () => {
    mockConvertFileSrc("windows");
    try {
      expect(runtimeAssetSource("C:\\Users\\misty\\.misty\\assets", "logos/misty-black.png")).toBe(
        "http://asset.localhost/C%3A%5CUsers%5Cmisty%5C.misty%5Cassets%5Clogos%5Cmisty-black.png",
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
