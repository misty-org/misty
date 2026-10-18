import { describe, expect, it } from "vitest";
import { githubRepoFromRemote } from "./code-projects";

describe("githubRepoFromRemote", () => {
  it("reads owner/name from HTTPS and SSH remotes", () => {
    expect(githubRepoFromRemote("https://github.com/misty/site.git")).toBe("misty/site");
    expect(githubRepoFromRemote("git@github.com:misty/site.git")).toBe("misty/site");
    expect(githubRepoFromRemote("https://github.com/misty/site")).toBe("misty/site");
  });

  it("ignores remotes that aren't on GitHub", () => {
    expect(githubRepoFromRemote("https://gitlab.com/misty/site.git")).toBe("");
    expect(githubRepoFromRemote(null)).toBe("");
  });
});
