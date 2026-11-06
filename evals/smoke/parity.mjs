// Compares what the mock model received from two runtimes running the smoke test's `agent` step:
//   node evals/smoke/parity.mjs <requests-a.json> <requests-b.json>
// IDs, dates and folder names differ on every run, so they're replaced before comparing. Key order
// counts, because it changes what a model's prompt cache sees.
import { readFileSync } from "node:fs";

const normalize = (text) =>
  text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/[0-9a-f]{64}/g, "<hash>")
    .replace(/scope_[0-9a-f]{32}/g, "<scope>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<time>")
    .replace(/victim-\d+/g, "victim-<pid>");

const load = (path) => JSON.parse(readFileSync(path, "utf8")).map((request) => ({ model: request.model, raw: normalize(request.raw) }));

const firstDifference = (a, b) => {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  return at === a.length && at === b.length ? -1 : at;
};

const [left, right] = process.argv.slice(2).map(load);
console.log(`${left.length} and ${right.length} requests`);
let different = 0;
for (let at = 0; at < Math.max(left.length, right.length); at++) {
  const [a, b] = [left[at], right[at]];
  const where = a && b ? firstDifference(a.raw, b.raw) : 0;
  if (where < 0 && a.model === b.model) continue;
  different++;
  console.log(`\nRequest ${at} (${a?.model} / ${b?.model}) differs at ${where}:`);
  console.log(`  a: …${a?.raw.slice(Math.max(0, where - 80), where + 240)}`);
  console.log(`  b: …${b?.raw.slice(Math.max(0, where - 80), where + 240)}`);
}
console.log(different ? `\n${different} requests differ.` : "\nEvery request matches.");
process.exit(different ? 1 : 0);
