import { describe, expect, it } from "vitest";
import type { AiInvocationEvent } from "../runs/invocations/invocationEventTypes";
import { claimedFiles, claimIdleMs, nextRunWork, relativeToFolders, writesFile } from "./runWork";
import { claimedByOthers, type TeammateAgent } from "./teammates";

const started = (toolName: string, path?: string) =>
  ({ id: "e", type: "tool.started", toolCallId: "c", toolName, path }) as AiInvocationEvent;

describe("claims", () => {
  it("counts writes, never reads", () => {
    expect(writesFile("Edit")).toBe(true);
    expect(writesFile("Write")).toBe(true);
    expect(writesFile("apply_patch")).toBe(true);
    expect(writesFile("file.write")).toBe(true);
    expect(writesFile("Read")).toBe(false);
    expect(writesFile("Grep")).toBe(false);
    expect(writesFile("browser.open")).toBe(false);
  });

  it("claims written files relative to a linked folder, newest first", () => {
    let work = nextRunWork(undefined, started("Edit", "/repo/src/a.ts"), 1);
    work = nextRunWork(work, started("Read", "/repo/src/b.ts"), 2);
    work = nextRunWork(work, started("Write", "/repo/src/c.ts"), 3);
    work = nextRunWork(work, started("Edit", "/elsewhere/d.ts"), 4);
    expect(work?.tool).toBe("Edit");
    expect(claimedFiles(work, ["/repo/"], 5)).toEqual(["src/c.ts", "src/a.ts"]);
  });

  it("ends with the run, or after a quiet half hour", () => {
    const work = nextRunWork(undefined, started("Edit", "/repo/a.ts"), 1);
    expect(claimedFiles(work, ["/repo"], 1 + claimIdleMs + 1)).toEqual([]);
    expect(
      nextRunWork(work, { id: "e", type: "invocation.completed" } as AiInvocationEvent, 2),
    ).toBeUndefined();
  });

  it("never sends a path outside the folders or one that climbs out", () => {
    expect(relativeToFolders("/Users/me/secret.txt", ["/repo"])).toBeUndefined();
    expect(relativeToFolders("../x.ts", ["/repo"])).toBeUndefined();
    expect(relativeToFolders("./src/x.ts", ["/repo"])).toBe("src/x.ts");
    expect(relativeToFolders("C:\\repo\\src\\x.ts", ["C:\\repo"])).toBe("src/x.ts");
  });

  it("warns about a teammate's working agent on the same file", () => {
    const mate = (state: TeammateAgent["state"]): TeammateAgent => ({
      key: "u:a",
      name: "Kai",
      owner: "Alex",
      state,
      doing: "",
      files: ["src/a.ts"],
    });
    expect(claimedByOthers(["src/a.ts"], [mate("working")])).toHaveLength(1);
    expect(claimedByOthers(["src/a.ts"], [mate("resting")])).toHaveLength(0);
    expect(claimedByOthers(["src/b.ts"], [mate("working")])).toHaveLength(0);
  });
});
