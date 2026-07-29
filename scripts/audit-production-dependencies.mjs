import { spawnSync } from "node:child_process";

/**
 * Production dependency advisories accepted after reachability review.
 *
 * Keep this list advisory-specific. A newly published high/critical advisory,
 * even for the same package, must fail CI until it has been reviewed.
 * Rationale and removal conditions live in docs/security/dependency-advisories.md.
 */
const acceptedAdvisories = new Set([
  1115805, // lodash-es template imports (unreached Excalidraw Mermaid converter)
  1124282, // React Router RSC action CSRF (Misty is a client-only BrowserRouter app)
]);

const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 16 * 1024 * 1024,
});

if (!result.stdout.trim()) {
  console.error(result.stderr || "npm audit did not return JSON.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("npm audit returned malformed JSON.");
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const unaccepted = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (vulnerability.severity !== "high" && vulnerability.severity !== "critical") continue;

  const advisories = collectAdvisories(name, vulnerabilities, new Set());
  const blocking = advisories.filter(
    (advisory) =>
      (advisory.severity === "high" || advisory.severity === "critical") &&
      !acceptedAdvisories.has(Number(advisory.source)),
  );

  if (blocking.length === 0 && advisories.length > 0) continue;
  unaccepted.push({ name, severity: vulnerability.severity, advisories: blocking });
}

if (unaccepted.length > 0) {
  console.error("Production dependency audit found unaccepted high/critical advisories:");
  for (const item of unaccepted) {
    const references = item.advisories.map((advisory) => `${advisory.source}: ${advisory.title}`);
    console.error(`- ${item.name} (${item.severity})${references.length ? ` — ${references.join("; ")}` : ""}`);
  }
  process.exit(1);
}

const totals = report.metadata?.vulnerabilities ?? {};
console.log(
  `Production dependency audit passed (${totals.high ?? 0} reviewed high, ${totals.critical ?? 0} critical, no unaccepted high/critical advisories).`,
);

function collectAdvisories(name, all, visited) {
  if (visited.has(name)) return [];
  visited.add(name);
  const vulnerability = all[name];
  if (!vulnerability) return [];

  return (vulnerability.via ?? []).flatMap((via) =>
    typeof via === "string" ? collectAdvisories(via, all, visited) : [via],
  );
}
