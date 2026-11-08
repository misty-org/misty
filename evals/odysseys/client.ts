// Drives a run in the debug app for the Odysseys eval: a run starts, works and ends on this computer, so
// this goes through the app's debug bridge (src-tauri/features/browser/agent_pages/eval_bridge), with no server.
import { randomUUID } from "node:crypto";
import { bridgeCall, windowCall, type Bridge } from "./bridge.ts";

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

/** How often a run's kept events are read. */
const pollMs = 250;
const terminal = /^invocation\.(completed|failed|canceled)$/;

interface RunFollow {
  state: string;
  events: Array<{ type: string; [key: string]: unknown }>;
}

export interface RunOptions {
  timeoutMs: number;
  /** The model turns this pass asks for. Only a debug build, which is the only one with a bridge, honors it. */
  turns: number;
  /** Sees every event as it arrives (the recorder captures pages with it). */
  observe?: (event: Record<string, unknown>) => Promise<void>;
  /** Looks at the run every `everyMs` and stops it when `check` gives a reason. */
  watch?: { everyMs: number; check(invocationId: string): Promise<string | undefined> };
}

export class EvalClient {
  /** Every run in progress, so a stopped pass can cancel them rather than leave them spending. */
  readonly active = new Set<string>();

  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  cancel(invocationId: string) {
    return bridgeCall(this.bridge, "/run-cancel", { runId: invocationId }).catch(() => undefined);
  }

  /** What a run's tools returned so far, from its journal on this computer. */
  async toolOutputs(invocationId: string): Promise<ToolOutput[]> {
    return bridgeCall<ToolOutput[]>(this.bridge, "/run-record", { runId: invocationId });
  }

  /** Starts one run in the app, and reads its events until it ends. */
  async run(body: Record<string, unknown>, options: RunOptions): Promise<EvalRun> {
    const created = await windowCall<{ invocationId: string; conversationId?: string }>(
      this.bridge,
      `const { aiSurfaceApi } = await module("features/ai-surface/api.ts");
       return aiSurfaceApi.createInvocation(request);`,
      {
        trigger: "message",
        context: [],
        executionMode: "user",
        idempotencyKey: `odysseys-${randomUUID()}`,
        timezone: "America/Los_Angeles",
        ...body,
        evalTurnLimit: options.turns,
      },
    );
    this.active.add(created.invocationId);
    // The observer learns which run this is before its first event (the recorder keeps to it).
    await options.observe?.({ type: "eval.created", invocationId: created.invocationId });
    const run: EvalRun = { invocationId: created.invocationId, conversationId: created.conversationId ?? "", terminal: "", answer: "", tools: [], events: [], error: "" };
    const deadline = Number.isFinite(options.timeoutMs) ? Date.now() + options.timeoutMs : Infinity;
    let stopped = "";
    const watch = options.watch;
    const looks = watch
      ? setInterval(() => {
          void watch.check(run.invocationId).then((reason) => {
            if (reason) stopped ||= reason;
          }).catch(() => undefined);
        }, watch.everyMs)
      : undefined;
    let read = 0;
    try {
      for (;;) {
        const follow = await bridgeCall<RunFollow>(this.bridge, "/run-follow", { runId: run.invocationId });
        for (const event of follow.events.slice(read)) {
          read++;
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
            await this.cancel(run.invocationId);
            return run;
          }
          if (terminal.test(event.type)) {
            run.terminal = event.type;
            run.error = String(event.error ?? "");
            return run;
          }
        }
        // Nothing knows of it and it never said how it ended: stop it, so it doesn't spend beside the next task.
        if (follow.state === "missing") {
          run.terminal = "stream.ended";
          await this.cancel(run.invocationId);
          return run;
        }
        if (stopped || Date.now() > deadline) {
          run.terminal = stopped || "timeout";
          await this.cancel(run.invocationId);
          return run;
        }
        await new Promise((done) => setTimeout(done, pollMs));
      }
    } catch (error) {
      run.terminal = `error: ${String(error).slice(0, 200)}`;
      await this.cancel(run.invocationId);
      return run;
    } finally {
      clearInterval(looks);
      this.active.delete(run.invocationId);
    }
  }
}
