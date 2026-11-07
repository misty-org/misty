// The pass's settings, from MISTY_ODYSSEYS_* variables. Anything
// that would make the pass meaningless or unsafe is refused here, before anything runs.
import { join, resolve } from "node:path";
import { judgeFromEnv, withAgentsEnv, type JudgeConfig } from "./judge-config.ts";
import { assertLocalUrl } from "./local.ts";

export const here = resolve(import.meta.dirname);


export interface Config {
  bridge: { url: string; token: string };
  judge: JudgeConfig;
  judgeImages: number;
  judgeLanes: number;
  turns: number;
  split: string;
  ids: string[];
  limit: number;
  offset: number;
  earlyStop: boolean;
  parallel: number;
  watchMs: number;
  taskMs: number;
  reportsDir: string;
}

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function whole(name: string, value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}, not ${value}.`);
  return parsed;
}

/** A server gives an ordinary run 20 turns and an eval at most 200, so only this range is honest. */
const minTurns = 21;
const maxTurns = 200;

export function judgeImagesFrom(env: Record<string, string | undefined>): number {
  return whole("MISTY_ODYSSEYS_JUDGE_IMAGES", env.MISTY_ODYSSEYS_JUDGE_IMAGES?.trim() || "60", 1, 200);
}

export function judgeLanesFrom(env: Record<string, string | undefined>): number {
  return whole("MISTY_ODYSSEYS_JUDGE_LANES", env.MISTY_ODYSSEYS_JUDGE_LANES?.trim() || "5", 1, 8);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const get = (name: string, fallback = "") => env[name]?.trim() || fallback;
  const bridgeUrl = get("MISTY_BROWSER_EVAL_BRIDGE").replace(/\/$/, "");
  const bridgeToken = get("MISTY_BROWSER_EVAL_BRIDGE_TOKEN");
  if (!bridgeUrl || !bridgeToken)
    throw new Error("Odysseys needs the desktop's eval bridge: set MISTY_BROWSER_EVAL_BRIDGE and MISTY_BROWSER_EVAL_BRIDGE_TOKEN.");
  assertLocalUrl("MISTY_BROWSER_EVAL_BRIDGE", bridgeUrl);

  const taskMinutes = get("MISTY_ODYSSEYS_TASK_MINUTES");
  return {
    bridge: { url: bridgeUrl, token: bridgeToken },
    judge: judgeFromEnv(withAgentsEnv(env)),
    judgeImages: judgeImagesFrom(env),
    judgeLanes: judgeLanesFrom(env),
    turns: whole("MISTY_ODYSSEYS_TURNS", get("MISTY_ODYSSEYS_TURNS", "100"), minTurns, maxTurns),
    split: get("MISTY_ODYSSEYS_SPLIT", "dev"),
    ids: list(get("MISTY_ODYSSEYS_TASKS")),
    limit: whole("MISTY_ODYSSEYS_LIMIT", get("MISTY_ODYSSEYS_LIMIT", "10"), 1, 200),
    offset: whole("MISTY_ODYSSEYS_OFFSET", get("MISTY_ODYSSEYS_OFFSET", "0"), 0, 200),
    // Off by default: a pass that stops early can't be compared with another.
    earlyStop: get("MISTY_ODYSSEYS_EARLY_STOP", "0") === "1",
    parallel: whole("MISTY_ODYSSEYS_PARALLEL", get("MISTY_ODYSSEYS_PARALLEL", "1"), 1, 8),
    // No clock ends a run: the progress watch (watchdog.ts) stops only a run that went quiet or
    // only repeats itself. MISTY_ODYSSEYS_TASK_MINUTES still sets a hard cap when one is wanted.
    watchMs: whole("MISTY_ODYSSEYS_WATCH_MINUTES", get("MISTY_ODYSSEYS_WATCH_MINUTES", "3"), 1, 60) * 60_000,
    taskMs: taskMinutes ? whole("MISTY_ODYSSEYS_TASK_MINUTES", taskMinutes, 1, 240) * 60_000 : Infinity,
    reportsDir: get("MISTY_ODYSSEYS_REPORTS", join(here, "reports")),
  };
}
