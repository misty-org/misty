import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const demoRoot = join(appRoot, ".demo");
export const fixtureRoot = join(appRoot, "demo", "product-research-hub");
export const manifestPath = join(fixtureRoot, "manifest.json");
export const serverRoot = resolve(process.env.MISTY_DEMO_SERVER_ROOT || join(appRoot, "..", "misty-server"));
export const statePath = join(demoRoot, "state.json");
export const credentialsPath = join(demoRoot, "credentials.json");

export function parseCLI(argv) {
  const command = argv[2] || "run";
  let target = "local";
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--target") target = argv[index + 1] || "";
    if (argv[index].startsWith("--target=")) target = argv[index].slice(9);
  }
  if (!["run", "seed", "verify", "live-check", "clean"].includes(command)) {
    throw new Error(`Unknown demo command: ${command}`);
  }
  if (!["local", "staging"].includes(target)) throw new Error("--target must be local or staging");
  if (command === "clean" && target !== "local") throw new Error("demo:clean only supports --target local");
  return { command, target };
}

export function normalizeAPIBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new Error("Demo server URL must start with http:// or https://");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function validateManifest(manifest) {
  const fail = (message) => { throw new Error(`Invalid demo manifest: ${message}`); };
  if (manifest?.scenarioVersion !== "product-research-hub@2") fail("unexpected scenarioVersion");
  if (manifest?.version !== 2 || manifest?.id !== "product-research-hub") fail("unexpected identity or version");
  if (!manifest.space?.name || !manifest.users?.owner || !manifest.users?.collaborator) fail("Space and two users are required");
  if (manifest.users.owner.email === manifest.users.collaborator.email) fail("demo emails must be unique");
  if (!manifest.users.owner.email.endsWith("@demo.misty.local") || !manifest.users.collaborator.email.endsWith("@demo.misty.local")) fail("demo emails require the reserved suffix");
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 6) fail("exactly six fixtures are required");
  const keys = new Set();
  for (const asset of manifest.assets) {
    if (!asset.key || keys.has(asset.key) || !asset.file || !asset.mimeType) fail("every asset needs a unique key, file, and MIME type");
    if (!["owner", "collaborator"].includes(asset.contributor)) fail(`invalid contributor for ${asset.key}`);
    keys.add(asset.key);
  }
  if (!manifest.album?.name || !manifest.agent?.name || !manifest.workflow?.name || !manifest.agentMessage) fail("album, Agent, workflow, and Agent message are required");
  if (!Array.isArray(manifest.workflow.definition?.nodes) || manifest.workflow.definition.nodes.length < 2) fail("workflow nodes are required");
  return manifest;
}

export async function loadManifest() {
  return validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

export async function readJSON(path, optional = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writePrivateJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function loadCredentials(target, manifest) {
  if (target === "staging") {
    const required = {
      adminToken: process.env.MISTY_DEMO_ADMIN_TOKEN,
      ownerPassword: process.env.MISTY_DEMO_OWNER_PASSWORD,
      collaboratorPassword: process.env.MISTY_DEMO_COLLABORATOR_PASSWORD,
    };
    const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new Error(`Missing staging demo secrets: ${missing.join(", ")}`);
    return { ...required, generatedAt: null };
  }
  const existing = await readJSON(credentialsPath, true);
  if (existing?.adminToken && existing?.ownerPassword && existing?.collaboratorPassword) return existing;
  const generated = {
    scenarioVersion: manifest.scenarioVersion,
    ownerEmail: manifest.users.owner.email,
    ownerPassword: randomBytes(18).toString("base64url"),
    collaboratorEmail: manifest.users.collaborator.email,
    collaboratorPassword: randomBytes(18).toString("base64url"),
    adminToken: randomBytes(32).toString("base64url"),
    generatedAt: new Date().toISOString(),
  };
  await writePrivateJSON(credentialsPath, generated);
  return generated;
}

export class Report {
  constructor(command, target, scenarioVersion) {
    this.data = { command, target, scenario_version: scenarioVersion, started_at: new Date().toISOString(), status: "running", phases: [], created_ids: {}, bugs: [] };
  }

  start(name, details = {}) {
    const phase = { name, status: "running", started_at: new Date().toISOString(), ...details };
    this.data.phases.push(phase);
    return phase;
  }

  finish(phase, details = {}) {
    Object.assign(phase, { status: "passed", finished_at: new Date().toISOString(), ...details });
  }

  fail(phase, error, classification = "harness") {
    Object.assign(phase, { status: "failed", finished_at: new Date().toISOString(), error: String(error?.stack || error) });
    this.data.bugs.push({ classification, phase: phase.name, error: String(error?.message || error) });
  }

  async save(status = "passed") {
    this.data.status = status;
    this.data.finished_at = new Date().toISOString();
    const reports = join(demoRoot, "reports");
    await mkdir(reports, { recursive: true, mode: 0o700 });
    const stamp = this.data.started_at.replace(/[:.]/g, "-");
    const path = join(reports, `${stamp}-${this.data.command}.json`);
    await writePrivateJSON(path, this.data);
    return path;
  }
}

export class APIClient {
  constructor(baseURL, token = "", report = null) {
    this.baseURL = normalizeAPIBase(baseURL);
    this.token = token;
    this.report = report;
  }

  withToken(token) { return new APIClient(this.baseURL, token, this.report); }

  async request(method, path, options = {}) {
    const url = path.startsWith("http") ? path : `${this.baseURL}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let body = options.body;
    if (body !== undefined && !(body instanceof Uint8Array) && !Buffer.isBuffer(body) && typeof body !== "string") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(options.timeout || 30_000), redirect: options.redirect || "follow" });
    const contentType = response.headers.get("content-type") || "";
    const payload = options.raw ? Buffer.from(await response.arrayBuffer()) : contentType.includes("json") ? await response.json() : await response.text();
    const accepted = response.ok || options.accept?.includes(response.status);
    this.report?.data.phases.push({ name: `HTTP ${method} ${new URL(url).pathname}`, status: accepted ? "passed" : "failed", http_status: response.status, at: new Date().toISOString() });
    if (!accepted) {
      const detail = typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500);
      const error = new Error(`${method} ${url} failed (${response.status}): ${detail}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { status: response.status, data: payload, headers: response.headers };
  }
}

export async function loginOrRegister(client, user, password, existingToken = "") {
  if (existingToken) {
    const current = await client.withToken(existingToken).request("GET", "/me", { accept: [401, 404] });
    if (current.status === 200 && current.data.email === user.email) {
      return { token: existingToken, user_id: current.data.id, name: current.data.name, username: current.data.username, email: current.data.email };
    }
  }
  const login = await client.request("POST", "/login", { body: { email: user.email, password }, accept: [401] });
  if (login.status === 200) return login.data;
  const registered = await client.request("POST", "/register", { body: { ...user, password } });
  return registered.data;
}

export async function fixtureData(asset) {
  const path = join(fixtureRoot, asset.file);
  const bytes = await readFile(path);
  return { path, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function demoRoutes(spaceID) {
  const paths = {
    library: `/spaces/${spaceID}/library`, chat: `/spaces/${spaceID}/chat`,
    agent: `/spaces/${spaceID}/studio/agents`, workflow: `/spaces/${spaceID}/studio/workflows`,
    members: `/spaces/${spaceID}/members`, settings: `/spaces/${spaceID}/settings/general`,
  };
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, deep_link: `misty://open${path}` }]));
}

export function assert(condition, message) {
  if (!condition) throw new Error(`Verification failed: ${message}`);
}
