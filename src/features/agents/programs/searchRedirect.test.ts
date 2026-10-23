import { describe, expect, it } from "vitest";
import { unwrapSearchRedirect } from "./searchRedirect";

const encode = (address: string) =>
  `a1${btoa(address).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

describe("unwrapSearchRedirect", () => {
  it("opens the address inside a Bing click-tracking link", () => {
    const target = "https://en.wikipedia.org/wiki/Latent_growth_modeling";
    expect(
      unwrapSearchRedirect(`https://www.bing.com/ck/a?!&&p=abc&u=${encode(target)}&ntb=1`),
    ).toBe(target);
  });

  it("opens the address inside a Google or DuckDuckGo redirect", () => {
    expect(
      unwrapSearchRedirect("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa&sa=U"),
    ).toBe("https://example.com/a");
    expect(
      unwrapSearchRedirect("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb"),
    ).toBe("https://example.org/b");
  });

  it("leaves other addresses alone", () => {
    expect(unwrapSearchRedirect("https://www.bing.com/search?q=cats")).toBe(
      "https://www.bing.com/search?q=cats",
    );
    expect(unwrapSearchRedirect("https://example.com/page")).toBe("https://example.com/page");
    expect(unwrapSearchRedirect("not a url")).toBe("not a url");
  });
});
