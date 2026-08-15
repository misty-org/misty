import { describe, expect, it } from "vitest";
import { validWebUrl } from "./YtdlpPlugin";

describe("validWebUrl", () => {
  it("accepts http and https URLs", () => {
    expect(validWebUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(validWebUrl("http://example.com/video")).toBe(true);
  });

  it("rejects local and executable URL schemes", () => {
    expect(validWebUrl("file:///etc/passwd")).toBe(false);
    expect(validWebUrl("http://localhost/video")).toBe(false);
    expect(validWebUrl("http://192.168.1.10/video")).toBe(false);
    expect(validWebUrl("javascript:alert(1)")).toBe(false);
    expect(validWebUrl("not a url")).toBe(false);
  });
});
