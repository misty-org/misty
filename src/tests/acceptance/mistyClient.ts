import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * A minimal Misty API client for live acceptance runs against the local
 * development server only. Each run registers a throwaway test account; the
 * latest one's generated credentials are kept in the git-ignored acceptance
 * folder for inspecting its data afterwards.
 */
export const acceptanceApi = (process.env.MISTY_ACCEPTANCE_API ?? "http://127.0.0.1:8081").replace(
  /\/$/,
  "",
);
const accountFile = new URL("../../../.misty/acceptance/account.json", import.meta.url);

function assertLocal(base: string) {
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) && !host.endsWith(".localhost"))
    throw new Error(`Acceptance runs only against a local server, not ${host}.`);
}

/**
 * Adds a member to a space directly in the local development database. The
 * invite route would send a real email through the development mail provider.
 */
export function seedSpaceMember(spaceId: string, userId: string) {
  runAcceptanceSQL(
    [spaceId, userId],
    `INSERT INTO space_members(space_id,user_id,role) VALUES ('${spaceId}','${userId}','member')`,
  );
}

/** Brings an agent into a space under its owner, as the agent's own tool does. */
export function seedSpaceAgent(spaceId: string, agentId: string, ownerId: string) {
  runAcceptanceSQL(
    [spaceId, agentId, ownerId],
    `INSERT INTO space_agents(space_id,agent_id,owner_user_id) VALUES ('${spaceId}','${agentId}','${ownerId}')`,
  );
}

function runAcceptanceSQL(ids: string[], sql: string) {
  if (!ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id))) throw new Error("unexpected id format");
  const container = process.env.MISTY_ACCEPTANCE_DB_CONTAINER ?? "misty-server-postgres-1";
  execFileSync("docker", [
    "exec",
    container,
    "psql",
    "-U",
    process.env.MISTY_ACCEPTANCE_DB_USER ?? "misty",
    "-d",
    process.env.MISTY_ACCEPTANCE_DB_NAME ?? "misty_server",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

/**
 * Marks a throwaway acceptance account's email verified in the local
 * development database: AI needs a verified email, and these accounts have no
 * inbox to confirm from.
 */
export function verifyAcceptanceEmail(userId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("unexpected id format");
  execFileSync("docker", [
    "exec",
    process.env.MISTY_ACCEPTANCE_DB_CONTAINER ?? "misty-server-postgres-1",
    "psql",
    "-U",
    process.env.MISTY_ACCEPTANCE_DB_USER ?? "misty",
    "-d",
    process.env.MISTY_ACCEPTANCE_DB_NAME ?? "misty_server",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE users SET email_verified_at=now() WHERE id='${userId}'`,
  ]);
}

const repository = fileURLToPath(new URL("../../..", import.meta.url));

async function bridgeCall<T>(path: string, body: unknown): Promise<T> {
  const address = process.env.MISTY_BROWSER_EVAL_BRIDGE ?? "http://127.0.0.1:47123";
  const response = await fetch(`${address}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MISTY_BROWSER_EVAL_BRIDGE_TOKEN ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const reply = (await response.json()) as { ok: boolean; result?: T; error?: string };
  if (!reply.ok) throw new Error(reply.error ?? String(response.status));
  return reply.result as T;
}

/** Runs the body of an async function in the app's window, with its modules and `request`. */
function windowCall<T>(script: string, request?: unknown): Promise<T> {
  const prelude = `const module = (path) => import("/@fs${repository}src/" + path);
const request = ${JSON.stringify(request ?? null)};`;
  return bridgeCall<T>("/window-eval", { script: `${prelude}\n${script}`, timeoutMs: 120_000 });
}

/** The app's default agent, which a run works as. */
export async function defaultAgentId(): Promise<string> {
  return windowCall<string>(
    `const { personalAgentsApi } = await module("features/agents/personalAgentsApi.ts");
     return (await personalAgentsApi.list()).agents[0]?.id ?? "";`,
  );
}

/** A run's state, as the window that follows it reads it. */
export async function runStateOf(runId: string): Promise<string> {
  return (await bridgeCall<{ state: string }>("/run-follow", { runId })).state;
}

export interface InvocationEvent {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface InvocationRun {
  invocationId: string;
  conversationId?: string;
  events: InvocationEvent[];
  text: string;
  tools: { name: string; outcome: "completed" | "failed" | "started" }[];
  terminal: string;
}

export class MistyClient {
  private cookies = new Map<string, string>();
  userId = "";

  static async register(): Promise<MistyClient> {
    assertLocal(acceptanceApi);
    const client = new MistyClient();
    // A fresh account per run keeps the seeded data exact.
    const suffix = randomBytes(4).toString("hex");
    const account = {
      email: `acceptance-${suffix}@example.test`,
      password: randomBytes(18).toString("base64url"),
    };
    const response = await client.raw("/register", {
      method: "POST",
      body: JSON.stringify({ ...account, name: "Acceptance", username: `acceptance_${suffix}` }),
    });
    if (!response.ok)
      throw new Error(`register failed: ${response.status} ${await response.text()}`);
    client.userId = ((await response.json()) as { user_id: string }).user_id;
    verifyAcceptanceEmail(client.userId);
    mkdirSync(new URL(".", accountFile), { recursive: true });
    writeFileSync(accountFile, JSON.stringify(account), { mode: 0o600 });
    return client;
  }

  /** Sends one request, refreshing an expired session once. */
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.send(path, init);
    if (response.status !== 401 || path === "/auth/refresh") return response;
    const refreshed = await this.send("/auth/refresh", { method: "POST" });
    return refreshed.ok ? this.send(path, init) : response;
  }

  private async send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    // Cookie-authenticated mutations need the app's explicit CSRF header.
    headers.set("X-Misty-CSRF", "1");
    if (this.cookies.size)
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    const response = await fetch(`${acceptanceApi}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.raw(path, init);
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Starts one run in the debug app through its eval bridge, and reads its events to the end. A run
   * works on this computer, so it needs the app running with `MISTY_BROWSER_EVAL_BRIDGE` and its token.
   */
  async invoke(
    prompt: string,
    options: Record<string, unknown> = {},
    timeoutMs = 240_000,
  ): Promise<InvocationRun> {
    const created = await windowCall<{ invocationId: string; conversationId?: string }>(
      `const { aiSurfaceApi } = await module("features/ai-surface/api.ts");
       return aiSurfaceApi.createInvocation(request);`,
      {
        mode: "drawer",
        surfaceId: "global",
        trigger: "message",
        prompt,
        context: [],
        executionMode: "user",
        idempotencyKey: `acceptance-${randomUUID()}`,
        timezone: "America/Los_Angeles",
        ...options,
      },
    );
    const run: InvocationRun = {
      invocationId: created.invocationId,
      conversationId: created.conversationId,
      events: [],
      text: "",
      tools: [],
      terminal: "",
    };
    const deadline = Date.now() + timeoutMs;
    let read = 0;
    while (Date.now() < deadline) {
      const follow = await bridgeCall<{ state: string; events: InvocationEvent[] }>("/run-follow", {
        runId: run.invocationId,
      });
      for (const event of follow.events.slice(read)) {
        read++;
        run.events.push(event);
        if (event.type === "response.delta") run.text += String(event.delta ?? "");
        if (event.type === "assistant.message") run.text = String(event.text ?? run.text);
        if (
          event.type === "tool.started" ||
          event.type === "tool.completed" ||
          event.type === "tool.failed"
        )
          run.tools.push({
            name: String(event.toolName).replace(/\./g, "_"),
            outcome: event.type.slice(5) as "completed" | "failed" | "started",
          });
        if (/^invocation\.(completed|failed|canceled)$/.test(event.type)) {
          run.terminal = event.type;
          return run;
        }
      }
      if (follow.state === "missing") {
        run.terminal = "stream.ended";
        return run;
      }
      await new Promise((done) => setTimeout(done, 300));
    }
    run.terminal = "timeout";
    await bridgeCall("/run-cancel", { runId: run.invocationId }).catch(() => undefined);
    return run;
  }
}
