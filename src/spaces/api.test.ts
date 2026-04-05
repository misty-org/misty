import { describe, expect, it } from "vitest";
import { fileNameFromPath, spaceErrorMessage } from "./api";

describe("fileNameFromPath", () => {
  it("keeps the selected filename for Unix and Windows paths", () => {
    expect(fileNameFromPath("/Users/misty/Pictures/library photo.jpg")).toBe("library photo.jpg");
    expect(fileNameFromPath("C:\\Users\\misty\\Pictures\\library photo.jpg")).toBe("library photo.jpg");
  });
});

describe("spaceErrorMessage", () => {
  it("does not expose raw provider OAuth errors to members", () => {
    expect(spaceErrorMessage("provider_not_configured", '{"code":"provider_not_configured","provider":"google"}')).toBe(
      "This provider’s sign-in is not available on the current Misty server.",
    );
  });
});
