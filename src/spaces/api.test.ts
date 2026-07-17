import { describe, expect, it } from "vitest";
import { fileNameFromPath } from "./api";

describe("fileNameFromPath", () => {
  it("keeps the selected filename for Unix and Windows paths", () => {
    expect(fileNameFromPath("/Users/misty/Pictures/library photo.jpg")).toBe("library photo.jpg");
    expect(fileNameFromPath("C:\\Users\\misty\\Pictures\\library photo.jpg")).toBe("library photo.jpg");
  });
});
