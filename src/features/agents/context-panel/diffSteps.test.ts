import { expect, it } from "vitest";
import { diffSteps } from "./diffSteps";
import { fileKind } from "./FilesPanel";

const patch = [
  "diff --git a/a.ts b/a.ts",
  "index 1..2 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,3 +1,3 @@ first",
  " keep",
  "-old",
  "+new",
  "@@ -10,2 +10,3 @@ second",
  " tail",
  "+added",
  "\\ No newline at end of file",
  "",
].join("\n");

it("splits a diff into its hunks, in order, without the file headers", () => {
  const steps = diffSteps(patch);
  expect(steps.map((step) => step.heading)).toEqual([
    "@@ -1,3 +1,3 @@ first",
    "@@ -10,2 +10,3 @@ second",
  ]);
  expect(steps[0]!.lines).toEqual([
    { kind: "same", text: "keep" },
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
  ]);
  const last = steps[1]!.lines;
  expect(last[last.length - 1]).toEqual({ kind: "note", text: "No newline at end of file" });
});

it("keeps what Git said about a file with no hunks", () => {
  expect(diffSteps("diff --git a/x.png b/x.png\nBinary files differ\n")).toEqual([
    {
      heading: "",
      lines: [
        { kind: "note", text: "diff --git a/x.png b/x.png" },
        { kind: "note", text: "Binary files differ" },
      ],
    },
  ]);
  expect(diffSteps("")).toEqual([]);
});

it("sorts files into kinds by their ending", () => {
  expect(fileKind("main.rs")).toBe("code");
  expect(fileKind("theme.css")).toBe("style");
  expect(fileKind("package.json")).toBe("data");
  expect(fileKind("README.md")).toBe("doc");
  expect(fileKind("Makefile")).toBeUndefined();
});
