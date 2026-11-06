// Runs a real agent through the real desktop app, against a scripted local model and a throwaway
// server (README.md). It starts and stops the app itself, because one check is killing it mid-run.
//
//   node evals/smoke/smoke.mjs [--runtime rust|typescript] [--only boot,signin,...] [--keep-app]
import { spawn, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForWindow } from "./bridge.mjs";
import { runSteps } from "./steps-run.mjs";
import { firstSteps } from "./steps.mjs";
import { windowErrors } from "./run.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = process.env.MISTY_SMOKE_DIR;
const server = process.env.MISTY_SMOKE_SERVER;
if (!scratch || !server) throw new Error("Set MISTY_SMOKE_DIR and MISTY_SMOKE_SERVER (README.md).");

const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const runtime = option("runtime") ?? "rust";
const only = option("only")?.split(",");
const keepApp = process.argv.includes("--keep-app");

mkdirSync(scratch, { recursive: true });
process.env.MISTY_BROWSER_EVAL_BRIDGE_TOKEN ??= randomBytes(24).toString("hex");
process.env.MISTY_BROWSER_EVAL_BRIDGE ??= "http://127.0.0.1:47123";
const dataRoot = resolve(scratch, "data");
const appPattern = "dev-apps/smoke.app/Contents/MacOS/misty-desktop";

const results = [];
function check(step, name, ok, evidence = "") {
  results.push({ step, name, ok: Boolean(ok), evidence: String(evidence).slice(0, 2000) });
  console.log(`${ok ? "pass" : "FAIL"}  ${step}: ${name}${evidence && !ok ? `\n      ${String(evidence).slice(0, 800)}` : ""}`);
}

const pids = (pattern) =>
  execSync(`pgrep -f '${pattern}' || true`).toString().split("\n").filter(Boolean).map(Number).filter((pid) => pid !== process.pid);

/** Resident memory in MB, read from `ps`: the process alone, not its WebKit helpers. */
function residentMB(pattern) {
  return pids(pattern).reduce((sum, pid) => {
    const kb = Number(execSync(`ps -o rss= -p ${pid} || echo 0`).toString().trim());
    return sum + kb / 1024;
  }, 0);
}

let mock;
function startMock() {
  mock = spawn(process.execPath, [resolve(repo, "evals/smoke/mock-model.mjs")], {
    stdio: "ignore",
    env: { ...process.env },
  });
}

const app = {
  pattern: appPattern,
  /** Starts `misty desktop dev` on isolated data; resolves when a window runs scripts. */
  async start() {
    const log = createWriteStream(resolve(scratch, "app.log"), { flags: "a" });
    const child = spawn(resolve(repo, "cli/target/release/misty"), ["desktop", "dev"], {
      cwd: repo,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MISTY_DATA_ROOT: dataRoot,
        MISTY_PROFILE: "smoke",
        MISTY_DESKTOP_PROFILE: "smoke",
        MISTY_DESKTOP_DEV_PORT: "5199",
        MISTY_BROWSER_EVAL_BRIDGE_PORT: "47123",
        // Until a server is chosen, a dev build talks to this one, never the shared dev stack.
        MISTY_PUBLIC_API_URL: `${server}/v1`,
        MISTY_PUBLIC_URL: server,
        ...(runtime === "typescript" ? { MISTY_AGENT_RUNTIME: "typescript" } : {}),
      },
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    await waitForWindow(600_000);
  },
  /** Kills the app the way a crash would, and waits for its dev server to go too. */
  async kill(signal = "SIGKILL") {
    // The baseline's Node process isn't tied to the app, so it would outlive a crash.
    for (const pid of [...pids(appPattern), ...pids("services/agent-runtime/.output")]) process.kill(pid, signal);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && (pids(appPattern).length || execSync("lsof -nP -iTCP:5199 -sTCP:LISTEN -t || true").toString().trim()))
      await new Promise((done) => setTimeout(done, 200));
  },
};

const seenErrors = new Map();
async function keepWindowErrors() {
  for (const entry of await windowErrors().catch(() => [])) seenErrors.set(`${entry.at}:${entry.text}`, entry);
}
const context = { check, app, residentMB, runtime, scratch, server, dataRoot, results, seenErrors };

async function main() {
  startMock();
  await new Promise((done) => setTimeout(done, 400));
  await app.start();
  for (const [name, step] of Object.entries({ ...firstSteps, ...runSteps })) {
    if (only && !only.includes(name)) continue;
    console.log(`\n== ${name}`);
    try {
      await step(context);
    } catch (error) {
      check(name, "the step finished", false, error?.stack ?? error);
    }
    await keepWindowErrors();
  }
}

try {
  await main();
} finally {
  if (!keepApp) await app.kill("SIGTERM");
  mock?.kill();
  writeFileSync(resolve(scratch, `report-${runtime}.json`), JSON.stringify(results, null, 2));
}
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report: ${resolve(scratch, `report-${runtime}.json`)}`);
process.exit(failed.length ? 1 : 0);
