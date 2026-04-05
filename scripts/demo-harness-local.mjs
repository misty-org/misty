import { spawn, spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import net from "node:net";
import { join, resolve } from "node:path";
import {
  APIClient, appRoot, demoRoot, normalizeAPIBase, serverRoot,
} from "./demo-harness-core.mjs";

const composeFile = join(serverRoot, "docker-compose.demo.yml");
const localPort = Number(process.env.MISTY_DEMO_SERVER_PORT || 8081);
if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) throw new Error("MISTY_DEMO_SERVER_PORT must be an unprivileged TCP port");
const localAPIBase = `http://127.0.0.1:${localPort}/api`;

export function targetAPIBase(target) {
  if (target === "local") return localAPIBase;
  const value = process.env.MISTY_DEMO_SERVER_URL;
  if (!value) throw new Error("MISTY_DEMO_SERVER_URL is required for --target staging");
  const base = normalizeAPIBase(value);
  if (new URL(base).protocol !== "https:") throw new Error("Staging demo server URL must use https");
  if (new URL(base).hostname === "localhost" || new URL(base).hostname === "127.0.0.1") {
    throw new Error("Staging target must not use a localhost server URL");
  }
  return base;
}

function run(command, args, options = {}) {
  const phase = options.report?.start(options.name || `${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || appRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error || result.status !== 0) {
    const message = result.error?.message || result.stderr || result.stdout || `exit ${result.status}`;
    const error = new Error(`${command} failed: ${String(message).trim()}`);
    if (phase) options.report.fail(phase, error, options.classification || "infrastructure");
    throw error;
  }
  if (phase) options.report.finish(phase, { exit_code: result.status });
  return result.stdout || "";
}

async function statusReady(adminToken) {
  try {
    const client = new APIClient(localAPIBase, adminToken);
    const response = await client.request("GET", "/internal/demo/status", { timeout: 2_000 });
    return response.data?.ready === true;
  } catch {
    return false;
  }
}

async function waitForReady(adminToken, report) {
  const phase = report.start("wait for local demo server");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await statusReady(adminToken)) {
      report.finish(phase);
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  const logs = spawnSync("docker", ["compose", "-p", "misty-demo", "-f", composeFile, "logs", "--no-color", "--tail", "100", "server"], { cwd: serverRoot, env: composeEnvironment(adminToken), encoding: "utf8" });
  const logTail = `${logs.stdout || ""}${logs.stderr || ""}`.slice(-4000);
  const error = new Error(`Local demo server did not become ready.\n${logTail}`);
  report.fail(phase, error, "infrastructure");
  throw error;
}

function composeEnvironment(adminToken) {
  return { ...process.env, MISTY_DEMO_ADMIN_TOKEN: adminToken, MISTY_DEMO_SERVER_PORT: String(localPort) };
}

function portOccupied() {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: localPort });
    socket.setTimeout(750);
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(false));
  });
}

export async function ensureLocalStack(credentials, report) {
  if (await statusReady(credentials.adminToken)) return { baseURL: localAPIBase, reused: true };
  if (await portOccupied()) throw new Error(`Port ${localPort} is occupied by a process that is not this demo stack. Stop it or set MISTY_DEMO_SERVER_PORT for an isolated test run.`);
  const composeEnv = composeEnvironment(credentials.adminToken);
  run("docker", ["compose", "-p", "misty-demo", "-f", composeFile, "up", "-d", "--wait", "--wait-timeout", "60", "postgres"], {
    cwd: serverRoot, env: composeEnv, report, name: "start isolated demo PostgreSQL",
  });
  const dsn = "host=127.0.0.1 port=5436 user=misty_demo password=misty-demo-local-only dbname=misty_demo sslmode=disable";
  run("goose", ["-dir", "db/migrations", "postgres", dsn, "up"], {
    cwd: serverRoot, report, name: "apply demo database migrations",
  });
  run("docker", ["compose", "-p", "misty-demo", "-f", composeFile, "up", "-d", "--build", "--wait", "--wait-timeout", "120", "server"], {
    cwd: serverRoot, env: composeEnv, report, name: "build and start isolated demo API",
  });
  await waitForReady(credentials.adminToken, report);
  return { baseURL: localAPIBase, reused: false };
}

function safeManagedPath(path, expected) {
  const actual = resolve(path);
  if (actual !== resolve(expected) || actual === "/" || actual.length < 10) throw new Error(`Refusing unsafe demo cleanup target: ${actual}`);
  return actual;
}

export async function cleanLocal(report) {
  run("docker", ["compose", "-p", "misty-demo", "-f", composeFile, "down", "-v", "--remove-orphans"], {
    cwd: serverRoot, env: composeEnvironment("clean-demo-placeholder-token-32chars"), report, name: "destroy isolated demo volumes",
  });
  const desktopDemoRoot = safeManagedPath(demoRoot, join(appRoot, ".demo"));
  const reportCopy = JSON.parse(JSON.stringify(report.data));
  await rm(desktopDemoRoot, { recursive: true, force: true });
  report.data = reportCopy;
}

export function launchDesktop(baseURL, routes, credentials) {
  console.log(`\nDemo owner (manual sign-in fallback): ${credentials.ownerEmail || "maya@demo.misty.local"} / ${credentials.ownerPassword}`);
  if (!credentials.ownerId || !credentials.ownerToken) {
    throw new Error("The seeded owner identity and session token are required to launch Misty.");
  }
  const child = spawn("npm", ["run", "tauri:desktop"], {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      MISTY_DESKTOP_INITIAL_ROUTE: routes.library.path,
      MISTY_PUBLIC_API_URL: baseURL,
      VITE_MISTY_DEMO_MODE: "1",
      VITE_MISTY_DEMO_SESSION_TOKEN: credentials.ownerToken,
      VITE_MISTY_DEMO_ACCOUNT: JSON.stringify({
        id: credentials.ownerId,
        name: credentials.ownerName,
        username: credentials.ownerUsername,
        email: credentials.ownerEmail,
      }),
    },
  });
  return new Promise((resolveLaunch, rejectLaunch) => {
    child.once("error", rejectLaunch);
    child.once("exit", (code) => code === 0 ? resolveLaunch() : rejectLaunch(new Error(`Misty desktop exited with ${code}`)));
  });
}
