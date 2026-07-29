import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const files = walk(dist);
const javascript = files.filter((file) => extname(file) === ".js");
const size = (file) => statSync(file).size;
const report = {
  generated_at: new Date().toISOString(),
  files: files.length,
  total_bytes: files.reduce((sum, file) => sum + size(file), 0),
  javascript_bytes: javascript.reduce((sum, file) => sum + size(file), 0),
  largest_javascript: javascript
    .map((file) => ({
      file: relative(dist, file).replaceAll("\\", "/"),
      bytes: size(file),
    }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 20),
  budgets: {
    total_bytes: 28 * 1024 * 1024,
    javascript_bytes: 19 * 1024 * 1024,
    single_javascript_bytes: 2 * 1024 * 1024,
  },
};
const outputDirectory = join(root, "artifacts", "release");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  join(outputDirectory, "bundle-size.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const largest = report.largest_javascript[0]?.bytes ?? 0;
console.log(
  `Bundle: ${(report.total_bytes / 1024 / 1024).toFixed(2)} MiB total, ` +
    `${(report.javascript_bytes / 1024 / 1024).toFixed(2)} MiB JavaScript, ` +
    `${(largest / 1024 / 1024).toFixed(2)} MiB largest chunk.`,
);
if (
  report.total_bytes > report.budgets.total_bytes ||
  report.javascript_bytes > report.budgets.javascript_bytes ||
  largest > report.budgets.single_javascript_bytes
) {
  throw new Error("production bundle exceeded its public-beta size budget");
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
