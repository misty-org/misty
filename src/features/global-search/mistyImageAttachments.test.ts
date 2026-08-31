import { describe, expect, it } from "vitest";
import { maxMistyImageBytes, validateMistyImage } from "./mistyImageAttachments";

describe("Misty image validation", () => {
  it("accepts JPEG, PNG, and WebP and rejects unsupported formats", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() =>
        validateMistyImage(new File(["ok"], `image.${type.slice(6)}`, { type })),
      ).not.toThrow();
    }
    expect(() => validateMistyImage(new File(["no"], "image.gif", { type: "image/gif" }))).toThrow(
      "must be a JPEG, PNG, or WebP",
    );
  });

  it("rejects files larger than 10 MB", () => {
    const file = new File([new Uint8Array(maxMistyImageBytes + 1)], "large.png", {
      type: "image/png",
    });
    expect(() => validateMistyImage(file)).toThrow("larger than 10 MB");
  });
});
