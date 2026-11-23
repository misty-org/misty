// @vitest-environment node
// It reads files from disk by their file URL, which only Node gives.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRules, rulesPath } from "../../../tasks/design_rules";

describe("design rules contract", () => {
  it("lists every UI rule as ui_rule_definitions.ts has it", async () => {
    expect(readFileSync(rulesPath, "utf8")).toBe(await buildRules());
  });
});
