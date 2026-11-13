import { describe, expect, it } from "vitest";
import { withDeniedFolder } from "./folderGrants";

const denial = (id: string, fields: { path?: string; message?: string; toolCallId?: string }) => ({
  id,
  type: "permission.denied" as const,
  message: fields.message ?? "Claude was refused.",
  ...fields,
});

describe("withDeniedFolder", () => {
  it("adds one pending card per refused path", () => {
    const grants = withDeniedFolder(undefined, denial("1", { path: "/Users/me/other/a.md" }));
    expect(grants).toEqual([
      {
        id: "1",
        path: "/Users/me/other/a.md",
        message: "Claude was refused.",
        toolCallId: undefined,
        toolName: undefined,
        status: "pending",
      },
    ]);
  });

  it("drops the turn's repeat of a refusal, by call or by open path", () => {
    let grants = withDeniedFolder(undefined, denial("1", { path: "/a/b.md", toolCallId: "t1" }));
    grants = withDeniedFolder(grants, denial("2", { toolCallId: "t1", message: "Other text" }));
    grants = withDeniedFolder(grants, denial("3", { path: "/a/b.md" }));
    expect(grants).toHaveLength(1);
  });

  it("offers a declined path again when a new call is refused", () => {
    const grants = withDeniedFolder(undefined, denial("1", { path: "/a/b.md" })).map((grant) => ({
      ...grant,
      status: "declined" as const,
    }));
    expect(withDeniedFolder(grants, denial("2", { path: "/a/b.md" }))).toHaveLength(2);
  });
});
