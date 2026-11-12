import { describe, expect, it } from "vitest";
import { leavesServer } from "./useServerSwitch";

describe("one server at a time", () => {
  const cloud = { mode: "server" as const, url: "https://api.mistysys.com/v1" };
  const own = { mode: "server" as const, url: "https://misty.example.org/v1" };

  it("restarts only when leaving a server in use", () => {
    expect(leavesServer(cloud, own)).toBe(true);
    expect(leavesServer(cloud, { mode: "none" })).toBe(true);
    expect(leavesServer(cloud, cloud)).toBe(false);
  });

  it("never restarts the first choice", () => {
    expect(leavesServer(null, cloud)).toBe(false);
    expect(leavesServer({ mode: "none" }, cloud)).toBe(false);
  });
});
