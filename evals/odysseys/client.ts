// A small Misty API client for the Odysseys eval, against a local stack only. It signs in as
// the local test account, so runs land in that account like any other run.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { assertLocalUrl } from "./local.ts";

export interface EvalRun {
  invocationId: string;
  conversationId: string;
  terminal: string;
  answer: string;
  /** Tool calls in order, model-visible names. */
  tools: string[];
  events: string[];
  /** Each failed run's reason from the event stream. */
  error: string;
}

export interface ToolOutput {
  tool_call_id: string;
  tool_name: string;
  sealed?: boolean;
  truncated?: boolean;
  output?: unknown;
}

/** Something wrong with the whole pass, not one task: it stops at once. */
export class FatalPassError extends Error {}

export interface RunOptions {
  timeoutMs: number;
  /** The model turns this pass asks for; the server's answer is checked against it. */
  turns: number;
  /** Sees every event as it arrives (the recorder captures pages with it). */
  observe?: (event: Record<string, unknown>) => Promise<void>;
  /** Looks at the run every `everyMs` and stops it when `check` gives a reason. */
  watch?: { everyMs: number; check(invocationId: string): Promise<string | undefined> };
}

export class EvalClient {
  private readonly api: string;
  private cookies = new Map<string, string>();
  /** Every run in progress, so a stopped pass can cancel them rather than leave them spending. */
  readonly active = new Set<string>();

  constructor(api: string) {
    assertLocalUrl("MISTY_ODYSSEYS_API", api);
    this.api = api.replace(/\/$/, "");
  }

  /** Signs in with the email and password saved in the sign-in file, which never enters the repository. */
  static async open(api: string, signInFile: string): Promise<EvalClient> {
    const client = new EvalClient(api);
    if (!existsSync(signInFile))
      throw new Error(`No sign-in file at ${signInFile}. It holds the local test account as {"email": "...", "password": "..."}.`);
    await client.json("/login", { method: "POST", body: readFileSync(signInFile, "utf8") });
    return client;
  }

  private async send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("X-Misty-CSRF", "1");
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${this.api}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  }

  /** One request, refreshing an expired session once. */
  async raw(path: string, init: RequestInit = {}) {
    const response = await this.send(path, init);
    if (response.status !== 401 || path === "/auth/refresh") return response;
    const refreshed = await this.send("/auth/refresh", { method: "POST" });
    return refreshed.ok ? this.send(path, init) : response;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.raw(path, init);
    const text = await response.text();
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  cancel(invocationId: string) {
    return this.raw(`/ai/invocations/${invocationId}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  /** What a run's tools returned so far, as its conversation stores it. */
  async toolOutputs(invocationId: string): Promise<ToolOutput[]> {
    return (await this.json<{ items?: ToolOutput[] }>(`/ai/invocations/${invocationId}/tool-output`)).items ?? [];
  }

  /** Starts one run and reads its events until it ends. */
  async run(body: Record<string, unknown>, options: RunOptions): Promise<EvalRun> {
    const key = `odysseys-${randomUUID()}`;
    const created = await this.json<{ invocationId: string; conversationId?: string; eventsUrl: string; modelTurnLimit?: number }>("/ai/invocations", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        trigger: "message",
        context: [],
        execution_mode: "user",
        idempotency_key: key,
        timezone: "America/Los_Angeles",
        ...body,
        eval_turn_limit: options.turns,
      }),
    });
    if (created.modelTurnLimit !== options.turns) {
      await this.cancel(created.invocationId);
      throw new FatalPassError(`The server gave this run ${created.modelTurnLimit ?? "an unknown number of"} turns, not ${options.turns}. A local stack with MISTY_ENVIRONMENT=development honors the eval's turn limit.`);
    }
    this.active.add(created.invocationId);
    // The observer learns which run this is before its first event (the recorder keeps to it).
    await options.observe?.({ type: "eval.created", invocationId: created.invocationId });
    const run: EvalRun = { invocationId: created.invocationId, conversationId: created.conversationId ?? "", terminal: "", answer: "", tools: [], events: [], error: "" };
    const controller = new AbortController();
    let stopped = "";
    const timer = Number.isFinite(options.timeoutMs) ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
    const watch = options.watch;
    const looks = watch
      ? setInterval(() => {
          void watch.check(run.invocationId).then((reason) => {
            if (!reason || controller.signal.aborted) return;
            stopped = reason;
            controller.abort();
          }).catch(() => undefined);
        }, watch.everyMs)
      : undefined;
    try {
      const response = await this.raw(created.eventsUrl, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`events: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const data = buffer.slice(0, end).split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          buffer = buffer.slice(end + 2);
          if (!data) continue;
          const event = JSON.parse(data) as { type: string; [key: string]: unknown };
          run.events.push(event.type);
          if (options.observe) await options.observe(event).catch(() => undefined);
          if (event.type === "response.delta") run.answer += String(event.delta ?? "");
          if (event.type === "assistant.message") run.answer = String(event.text ?? run.answer);
          // Started events carry catalog names (note.search); the model sees underscores.
          if (event.type === "tool.started") run.tools.push(String(event.toolName).replace(/\./g, "_"));
          // Nobody answers an approval card in an eval: record the card and stop the run rather
          // than wait for it. Pay, send, post, delete and sign-up are never auto-approved.
          if (event.type === "approval.required" || event.type === "app.request") {
            run.terminal = `needs_person:${event.type}`;
            await reader.cancel();
            await this.cancel(run.invocationId);
            return run;
          }
          if (/^invocation\.(completed|failed|canceled)$/.test(event.type)) {
            run.terminal = event.type;
            run.error = String(event.error ?? "");
            await reader.cancel();
            return run;
          }
        }
      }
      // The stream closed with the run still going: stop it, so it doesn't spend beside the next task.
      run.terminal = "stream.ended";
      await this.cancel(run.invocationId);
      return run;
    } catch (error) {
      run.terminal = controller.signal.aborted ? stopped || "timeout" : `error: ${String(error).slice(0, 200)}`;
      await this.cancel(run.invocationId);
      return run;
    } finally {
      clearTimeout(timer);
      clearInterval(looks);
      this.active.delete(run.invocationId);
    }
  }
}
