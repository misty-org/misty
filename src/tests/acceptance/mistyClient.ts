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
  if (![spaceId, userId].every((id) => /^[A-Za-z0-9_-]+$/.test(id)))
    throw new Error("unexpected id format");
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
    `INSERT INTO space_members(space_id,user_id,role) VALUES ('${spaceId}','${userId}','member')`,
  ]);
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

  /** Starts one invocation and reads its event stream to the end. */
  async invoke(
    prompt: string,
    options: Record<string, unknown> = {},
    timeoutMs = 240_000,
  ): Promise<InvocationRun> {
    const idempotencyKey = `acceptance-${randomUUID()}`;
    const created = await this.json<{
      invocationId: string;
      conversationId?: string;
      eventsUrl: string;
    }>("/ai/invocations", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        mode: "drawer",
        surface_id: "global",
        trigger: "message",
        prompt,
        context: [],
        execution_mode: "user",
        idempotency_key: idempotencyKey,
        timezone: "America/Los_Angeles",
        ...options,
      }),
    });
    const run: InvocationRun = {
      invocationId: created.invocationId,
      conversationId: created.conversationId,
      events: [],
      text: "",
      tools: [],
      terminal: "",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.raw(created.eventsUrl, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`events: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data) as InvocationEvent;
          run.events.push(event);
          if (event.type === "response.delta") run.text += String(event.delta ?? "");
          if (event.type === "assistant.message") run.text = String(event.text ?? run.text);
          if (
            event.type === "tool.started" ||
            event.type === "tool.completed" ||
            event.type === "tool.failed"
          )
            run.tools.push({
              // Started events carry catalog names (notes.search), others model names.
              name: String(event.toolName).replace(/\./g, "_"),
              outcome: event.type.slice(5) as "completed" | "failed" | "started",
            });
          if (/^invocation\.(completed|failed|canceled)$/.test(event.type)) {
            run.terminal = event.type;
            await reader.cancel();
            return run;
          }
        }
      }
      run.terminal = "stream.ended";
      return run;
    } catch (error) {
      run.terminal = controller.signal.aborted ? "timeout" : `error: ${String(error)}`;
      return run;
    } finally {
      clearTimeout(timer);
    }
  }
}
