// What each pass records about itself, so two passes can prove they measured the same thing.
// The report holds no key: the bridge's model list has none, and the judge's key stays in memory.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DeviceModels } from "./bridge.ts";
import type { JudgeConfig } from "./judge-config.ts";
import type { OdysseysRun, summary } from "./results.ts";

export const reportSchema = 1;

export interface CommitState {
  sha: string;
  /** Uncommitted changes were present: the commit alone doesn't reproduce the code. */
  dirty: boolean;
}

export interface PassReport {
  schema: number;
  /** Which agent runtime the person says this pass measured. */
  runtime: string;
  startedAt: string;
  finishedAt: string;
  /** Read from the device's settings, never set by the pass. */
  device: DeviceModels;
  turnLimit: number;
  parallel: number;
  commit: { misty: CommitState | null; server: CommitState | null };
  judge: { model: string; provider: string; host: string; maxImages: number };
  dataSha256: string;
  split: string;
  offset: number;
  limit: number;
  taskIds: string[];
  /** Why the pass ended before its last task; empty for a whole pass. */
  stopped: string;
  pageProcesses: { before: number | undefined; leaked: number };
  summary: ReturnType<typeof summary>;
  runs: OdysseysRun[];
}

export function judgeRecord(judge: JudgeConfig, maxImages: number): PassReport["judge"] {
  return { model: judge.model, provider: judge.provider, host: new URL(judge.baseUrl).host, maxImages };
}

export function commitState(dir: string): CommitState | null {
  if (!existsSync(dir)) return null;
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { sha: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
  } catch {
    return null;
  }
}

/** The commits of this checkout and of the server beside it. */
export function commits(): PassReport["commit"] {
  const root = resolve(import.meta.dirname, "../..");
  return { misty: commitState(root), server: commitState(resolve(root, "../misty-server")) };
}

export function loadPass(folder: string): PassReport {
  const file = join(folder, "report.json");
  if (!existsSync(file)) throw new Error(`No report.json in ${folder}.`);
  return JSON.parse(readFileSync(file, "utf8")) as PassReport;
}
