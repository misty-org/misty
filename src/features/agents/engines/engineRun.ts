import { agentAccountId } from "../personal/agentAccount";
import { desktopDeviceGrants } from "../personal/deviceGrants";
import { aiSurfaceApi, subscribeToAiInvocation } from "../runs/invocations/api";
import { warmLocalRun } from "../runs/local-run/startRun";
import type { AiInvocationRequest } from "../runs/invocations/invocationTypes";
import { followAddress } from "../runs/local-run/localRunParts";
import { defaultEngineAgent, resolveDefaultEngine } from "./defaultEngine";
import { listEngines } from "./enginesApi";

/**
 * One piece of Misty's own work on the default engine: the Lab's jobs and questions, Tutor's
 * turns, pointing, reading a page. It's a run with no agent chat behind it (nothing is saved as a
 * conversation, and the chats list never shows it), and several run side by side without waiting
 * on the person's own chat.
 */

export const noDefaultEngine = "Pick a default engine in Settings › Agents.";

export interface EngineRunInput {
  prompt: string;
  /** What it's for, in a few words, so the run's id is stable for this piece of work. */
  key: string;
  /**
   * Runs that carry one engine session on from turn to turn, keeping the engine's process warm
   * between them: Tutor's spoken turns ("tutor:…"). Each run is its own otherwise.
   */
  session?: string;
  /** Where the work is from, so the engine's Space tools act on that Space. */
  spaceId?: string;
  /** The earlier turns, oldest first, for a follow-up. */
  history?: { prompt: string; reply?: string; at: string }[];
  /** Screens to look at, as Tutor sends them; a companion turn points with [POINT] tags. */
  companion?: Pick<AiInvocationRequest, "companionMode" | "displayCaptures">;
  /** Images the engine is shown, as data URLs. */
  images?: { mimeType: string; dataUrl: string }[];
  /** Streams the answer as it's written. */
  onText?(text: string): void;
  /** The run's id as soon as it has started, to follow it again after a restart. */
  onStarted?(runId: string): void;
  signal?: AbortSignal;
}

export interface EngineRunResult {
  runId: string;
  /** The finished answer, or "" when it stopped without one. */
  text: string;
  error?: string;
}

/** The engine list, read once a session: running every CLI's --version on each job would be slow. */
let engines: ReturnType<typeof listEngines> | undefined;
const knownEngines = () =>
  (engines ??= listEngines().catch((error) => {
    engines = undefined;
    throw error;
  }));

/** The default engine's id, or why there is none. */
export async function defaultEngineId(): Promise<string> {
  const { engine } = resolveDefaultEngine(await knownEngines());
  if (!engine) throw new Error(noDefaultEngine);
  return engine.id;
}

/** Starts the work and follows it to its end. Resolves once it has ended, however it ended. */
export async function runOnEngine(input: EngineRunInput): Promise<EngineRunResult> {
  const created = await aiSurfaceApi.createInvocation(await engineRequest(input));
  input.onStarted?.(created.invocationId);
  return followEngineRun(created.invocationId, input);
}

/**
 * Gets the engine ready for a run that is about to start on `input.session`, before its prompt is
 * known: Tutor calls it as the talk keys go down on a session with no turn yet, so the engine's
 * start-up happens while the person talks (`engines/warm_up.rs`). Only the session and what
 * decides how the engine is launched count; `key` names the warm-up. Resolves once it's ready, or
 * once it's clear there is nothing to warm.
 */
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
    // A conversation of its own that is never saved as a chat: the run's work is the caller's.
    conversationId: `misty_${input.session ?? input.key}`,
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

/** Follows a run already started, as after a restart, to its end. */
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

/** Stops a run. */
export const stopEngineRun = (runId: string) =>
  aiSurfaceApi.cancelInvocation(runId).catch(() => undefined);
