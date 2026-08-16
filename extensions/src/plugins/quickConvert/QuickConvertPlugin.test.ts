import { describe, expect, it } from "vitest";
import { mediaKind } from "./QuickConvertPlugin";

describe("mediaKind", () => {
  it("classifies supported media without case sensitivity", () => {
    expect(mediaKind("/tmp/photo.HEIC")).toBe("image");
    expect(mediaKind("/tmp/song.FLAC")).toBe("audio");
    expect(mediaKind("/tmp/movie.MKV")).toBe("video");
  });

  it("does not infer unsupported or extensionless inputs", () => {
    expect(mediaKind("/tmp/archive.zip")).toBe("unknown");
    expect(mediaKind("/tmp/README")).toBe("unknown");
  });
});
