import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  nextUiBaseline,
  parseUiBaseline,
  uiExceptionsBaselinePath,
  uiRuleTotals,
} from "./ui_baseline.ts";
import {
  allRules,
  cssRules,
  uiRules,
  type AppUiRuleId,
  type CssRuleId,
  type UiRule,
  type UiRuleId,
  type UiViolationCounts,
  type UiViolationMap,
} from "./ui_rule_definitions.ts";

export { uiRuleGuidance, uiRuleIds, type UiRuleId } from "./ui_rule_definitions.ts";
export {
  nextUiBaseline,
  parseUiBaseline,
  uiExceptionsBaselinePath,
  type UiBaseline,
} from "./ui_baseline.ts";

type UiRuleScope = "app" | "css";

function uiRuleScope(path: string): UiRuleScope | null {
  if (/\.test\.tsx?$/.test(path) || path.endsWith(".d.ts") || path.startsWith("src/tests/")) {
    return null;
  }
  if (path.endsWith(".css")) {
    if (!path.startsWith("src/") || path.startsWith("src/styles/")) return null;
    return "css";
  }
  if (!/^src\/.*\.tsx?$/.test(path)) return null;
  return "app";
}

function rulesFor(scope: UiRuleScope): UiRuleId[] {
  if (scope === "css") return Object.keys(cssRules) as CssRuleId[];
  return Object.keys(uiRules) as AppUiRuleId[];
}

function withoutComments(text: string, css: boolean): string {
  const blank = (part: string) => part.replace(/[^\n]/g, " ");
  const blocks = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  return css ? blocks : blocks.replace(/(?<=^|\s)\/\/[^\n]*/gm, blank);
}

function countRule(rule: UiRule, text: string, path: string): number {
  if (rule.allow?.some((allowed) => allowed.test(path))) return 0;
  if (rule.jsx && !path.endsWith(".tsx")) return 0;
  if (rule.count) return rule.count(text, path);
  if (!rule.pattern) return 0;
  return text.match(rule.pattern)?.length ?? 0;
}

export function uiViolationCounts(path: string, text: string): UiViolationCounts {
  const scope = uiRuleScope(path);
  if (!scope) return {};
  const source = withoutComments(text, scope === "css");
  const counts: UiViolationCounts = {};
  for (const id of rulesFor(scope)) {
    const count = countRule(allRules[id], source, path);
    if (count > 0) counts[id] = count;
  }
  return counts;
}

function walkSource(root: string, directory: string, paths: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walkSource(root, absolute, paths);
    else if (entry.isFile()) paths.push(relative(root, absolute).split("\\").join("/"));
  }
  return paths;
}

export function collectUiViolations(root: string): UiViolationMap {
  const found: UiViolationMap = {};
  const paths = walkSource(root, join(root, "src"), []).filter((path) => uiRuleScope(path));
  for (const path of paths.sort()) {
    const counts = uiViolationCounts(path, readFileSync(join(root, path), "utf8"));
    if (Object.keys(counts).length) found[path] = counts;
  }
  return found;
}

if (process.argv.includes("--write-baseline")) {
  const root = process.cwd();
  const baselineFile = join(root, uiExceptionsBaselinePath);
  const previous = parseUiBaseline(
    existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : {},
  );
  const update = nextUiBaseline(previous, collectUiViolations(root));
  writeFileSync(baselineFile, `${JSON.stringify(update.baseline, null, 2)}\n`);

  const newIds = Object.keys(update.newRules);
  if (newIds.length) {
    console.log(`New rules start locked at zero; fix these hits first:`);
    for (const id of newIds) console.log(`  ${id}: ${update.newRules[id as UiRuleId]}`);
  }
  console.log(
    `Locked at zero (${update.baseline.locked.length}): ${update.baseline.locked.join(", ")}`,
  );
  if (update.lowered.length) {
    console.log(`Lowered (${update.lowered.length}):`);
    for (const line of update.lowered) console.log(`  ${line}`);
  }
  console.log("Per rule (hits in files):");
  for (const [id, total] of Object.entries(uiRuleTotals(update.baseline.files))) {
    console.log(`  ${id}: ${total.hits} in ${total.files}`);
  }
  console.log(`${Object.keys(update.baseline.files).length} files with UI exceptions`);
  if (update.refused.length) {
    console.error(`Refused, above the baseline (fix these; the baseline never grows):`);
    for (const line of update.refused) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}
