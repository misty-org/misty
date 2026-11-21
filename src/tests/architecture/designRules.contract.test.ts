// @vitest-environment node
// It reads files from disk by their file URL, which only Node gives.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRules, rulesPath } from "../../../tasks/design-rules";

// docs/design/rules.md is read from uiRuleDefinitions.ts. When a rule changes,
// `npm run design:rules` writes it again; this fails until it has.
describe("design rules contract", () => {
  it("lists every UI rule as uiRuleDefinitions.ts has it", async () => {
    expect(readFileSync(rulesPath, "utf8")).toBe(await buildRules());
  });
});
