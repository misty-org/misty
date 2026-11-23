import { describe, expect, it } from "vitest";
import { acceptsFile } from "./space_app_files";

describe("acceptsFile", () => {
  it("matches wildcards, extensions and exact types, and accepts everything with no list", () => {
    expect(acceptsFile([], "text/plain", "a.txt")).toBe(true);
    expect(acceptsFile(["image/*"], "image/png", "a.png")).toBe(true);
    expect(acceptsFile(["image/*"], "video/mp4", "a.mp4")).toBe(false);
    expect(acceptsFile([".psd"], "application/octet-stream", "Poster.PSD")).toBe(true);
    expect(acceptsFile(["application/pdf"], "application/pdf", "a.pdf")).toBe(true);
    expect(acceptsFile(["application/pdf"], "image/png", "a.png")).toBe(false);
  });
});
