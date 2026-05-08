import { describe, expect, it } from "vitest";
import { parseHomeCommand } from "./homeCommand";

describe("home command input", () => {
  it("opens explicit URLs in the browser", () => {
    expect(parseHomeCommand("https://example.com/docs")).toEqual({
      kind: "url",
      url: "https://example.com/docs",
    });
  });

  it("completes a bare host to HTTPS", () => {
    expect(parseHomeCommand("github.com/misty")).toEqual({
      kind: "url",
      url: "https://github.com/misty",
    });
    expect(parseHomeCommand("localhost:5173")).toEqual({
      kind: "url",
      url: "https://localhost:5173",
    });
  });

  it("treats absolute and home-relative paths as Files", () => {
    expect(parseHomeCommand("/Users/me/Documents")).toEqual({
      kind: "path",
      path: "/Users/me/Documents",
    });
    expect(parseHomeCommand("~/Downloads")).toEqual({ kind: "path", path: "~/Downloads" });
  });

  it("routes a question to the agent and everything else to search", () => {
    expect(parseHomeCommand("where did I put the invoice?")).toEqual({
      kind: "ask",
      query: "where did I put the invoice?",
    });
    expect(parseHomeCommand("quarterly report")).toEqual({
      kind: "search",
      query: "quarterly report",
    });
  });

  it("does not mistake a sentence containing a dot for a host", () => {
    // "Sentences with words." would otherwise match the bare-host pattern.
    expect(parseHomeCommand("ship it. then rest")).toMatchObject({ kind: "search" });
  });

  it("ignores blank input", () => {
    expect(parseHomeCommand("   ")).toBeNull();
  });
});
