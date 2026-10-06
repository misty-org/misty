import { describe, expect, it } from "vitest";
import { inputIntent } from "./inputIntent";

describe("inputIntent", () => {
  it.each([
    ["https://misty.app/pricing", "url"],
    ["github.com", "url"],
    ["docs.example.co.uk/guide?x=1", "url"],
    ["localhost:5173", "url"],
    ["127.0.0.1:8080/health", "url"],
    ["about:blank", "url"],
    ["cats", "search"],
    ["best pizza brooklyn", "search"],
    ["weather tomorrow", "search"],
    ["Launch team", "search"],
    ["what is the launch date?", "ask"],
    ["how do I export my notes", "ask"],
    ["can you summarize this page", "ask"],
    ["summarize this page", "ask"],
    ["draft a reply to Sam", "ask"],
    ["i need a packing list for Tokyo", "ask"],
    ["please book a table for two", "ask"],
    ["react vs vue?", "ask"],
    ["", "search"],
  ])("%s → %s", (input, intent) => {
    expect(inputIntent(input)).toBe(intent);
  });
});
