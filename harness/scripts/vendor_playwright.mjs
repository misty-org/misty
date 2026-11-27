import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const checkout = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node scripts/vendor_playwright.mjs <path to a microsoft/playwright checkout>");
  process.exit(2);
}
const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"]).toString().trim();
const license = readFileSync(join(checkout, "packages/injected/src/roleUtils.ts"), "utf8").match(/^\/\*\*[\s\S]*?\*\//)[0];
const result = await build({
  entryPoints: [join(here, "playwright_roles_entry.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
  alias: {
    "@injected": join(checkout, "packages/injected/src"),
    "@isomorphic": join(checkout, "packages/isomorphic"),
  },
});
const header = `${license}\n// Bundled from microsoft/playwright@${commit} (packages/injected/src/roleUtils.ts and what it\n// imports) by harness/scripts/vendor_playwright.mjs. Do not edit; run the script again.\n`;
const out = join(here, "../crates/page-runtime/js/vendor_playwright_roles.js");
writeFileSync(out, header + result.outputFiles[0].text.replaceAll(checkout, "playwright"));
console.log(`wrote ${out}`);
