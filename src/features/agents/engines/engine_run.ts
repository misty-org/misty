import { agentAccountId } from "../personal/agent_account";
import { desktopDeviceGrants } from "../personal/device_grants";
import { aiSurfaceApi, subscribeToAiInvocation } from "../runs/invocations/api";
import { warmLocalRun } from "../runs/local-run/start_run";
import type { AiInvocationRequest } from "../runs/invocations/invocation_types";
import { followAddress } from "../runs/local-run/local_run_parts";
import { defaultEngineAgent, resolveDefaultEngine } from "./default_engine";
import { listEngines } from "./engines_api";

export const noDefaultEngine = "Pick a default engine in Settings › Agents.";

export interface EngineRunInput {
  prompt: string;
  key: string;
  session?: string;
  spaceId?: string;
  history?: { prompt: string; reply?: string; at: string }[];
  companion?: Pick<AiInvocationRequest, "companionMode" | "displayCaptures">;
  images?: { mimeType: string; dataUrl: string }[];
  onText?(text: string): void;
  onStarted?(runId: string): void;
  signal?: AbortSignal;
}

export interface EngineRunResult {
  runId: string;
  text: string;
  error?: string;
}

let engines: ReturnType<typeof listEngines> | undefined;
const knownEngines = () =>
  (engines ??= listEngines().catch((error) => {
    engines = undefined;
    throw error;
  }));

export async function defaultEngineId(): Promise<string> {
  const { engine } = resolveDefaultEngine(await knownEngines());
  if (!engine) throw new Error(noDefaultEngine);
  return engine.id;
}

export async function runOnEngine(input: EngineRunInput): Promise<EngineRunResult> {
  const created = await aiSurfaceApi.createInvocation(await engineRequest(input));
  input.onStarted?.(created.invocationId);
  return followEngineRun(created.invocationId, input);
}

export async function warmEngine(input: Omit<EngineRunInput, "prompt">): Promise<void> {
  await warmLocalRun(await engineRequest({ ...input, prompt: "" }));
}

async function engineRequest(input: EngineRunInput): Promise<AiInvocationRequest> {
  const engineId = await defaultEngineId();
  return {
    mode: input.companion ? "companion" : "quick",
    surfaceId: "global",
    trigger: "message",
    prompt: input.prompt,
    context: [],
    engineId,
    agentId: defaultEngineAgent(engineId),
    spaceId: input.spaceId,
    conversationId: `misty_${(input.session ?? input.key).replace(/[^A-Za-z0-9_-]/g, "_")}`,
    executionMode: "user",
    collaborationMode: "act",
    permissionMode: "auto",
    images: input.images,
    historyTurns: input.history?.map((turn) => ({
      prompt: turn.prompt,
      reply: turn.reply,
      created_at: turn.at,
    })),
    deviceContexts: await desktopDeviceGrants().catch(() => []),
    idempotencyKey: `misty:${input.key}:${agentAccountId()}`,
    ...input.companion,
  };
}

export function followEngineRun(
  runId: string,
  input: Pick<EngineRunInput, "onText" | "signal"> = {},
): Promise<EngineRunResult> {
  return new Promise((done) => {
    let text = "";
    let finished = false;
    const end = (result: Omit<EngineRunResult, "runId">) => {
      if (finished) return;
      finished = true;
      stop();
      done({ runId, ...result });
    };
    const stop = subscribeToAiInvocation(followAddress(runId), {
      onEvent: (event) => {
        if (event.type === "response.delta") {
          text += event.delta;
          input.onText?.(text);
        }
        if (event.type === "assistant.message") {
          text = event.text;
          input.onText?.(text);
        }
        if (event.type === "invocation.completed") end({ text });
        if (event.type === "invocation.canceled") end({ text, error: "Stopped." });
        if (event.type === "invocation.failed") end({ text, error: event.error });
      },
      onError: (error) => end({ text, error: error.message }),
    });
    input.signal?.addEventListener("abort", () => {
      void aiSurfaceApi.cancelInvocation(runId).catch(() => undefined);
      end({ text, error: "Stopped." });
    });
  });
}

export const stopEngineRun = (runId: string) =>
  aiSurfaceApi.cancelInvocation(runId).catch(() => undefined);
