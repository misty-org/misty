import { describe, expect, it } from "vitest";
import { readQuery } from "./searchQuery";

const agents = [
  { id: "a1", name: "Code" },
  { id: "a2", name: "Code reviewer" },
];

describe("search prefixes", () => {
  it("narrows to commands or the Space", () => {
    expect(readQuery("> theme", agents)).toEqual({ text: "theme", kind: "commands" });
    expect(readQuery("/theme", agents)).toEqual({ text: "theme", kind: "commands" });
    expect(readQuery("#roadmap", agents)).toEqual({ text: "roadmap", kind: "space" });
  });

  it("asks the longest agent name typed after @", () => {
    expect(readQuery("@code reviewer check the PR", agents).ask).toEqual({
      agentId: "a2",
      prompt: "check the PR",
    });
    expect(readQuery("@Code fix it", agents).ask).toEqual({ agentId: "a1", prompt: "fix it" });
    expect(readQuery("@codex hi", agents).ask).toBeUndefined();
  });


  it("reads plain words as a search, never as something to make", () => {
    expect(readQuery("new task: ship search", agents)).toEqual({ text: "new task: ship search" });
    expect(readQuery("  note: ideas", agents)).toEqual({ text: "note: ideas" });
  });
});
