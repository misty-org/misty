// npm run compare -- <baseline pass folder> <candidate pass folder>
// Exits 0 when the candidate is the same or better, 1 when it isn't, 2 when the passes can't be compared.
import { CompareRefusal, comparePasses, formatComparison } from "./compare.ts";
import { loadPass } from "./report.ts";

const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate) {
  process.stderr.write("Usage: npm run compare -- <baseline pass folder> <candidate pass folder>\n");
  process.exit(2);
}
try {
  const [a, b] = [loadPass(baseline), loadPass(candidate)];
  const result = comparePasses(a, b);
  process.stdout.write(formatComparison(a, b, result));
  process.exit(result.sameOrBetter ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error instanceof CompareRefusal ? "Refused: " : ""}${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
