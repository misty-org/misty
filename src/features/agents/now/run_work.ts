import { create } from "zustand";
import type { AiInvocationEvent } from "../runs/invocations/invocation_event_types";
import { watchAllRunEvents } from "../runs/local-run/local_run_events";

export const claimIdleMs = 30 * 60 * 1000;
const maxClaimedFiles = 5;

export interface RunWork {
  tool: string;
  at: number;
  writes: Record<string, number>;
}

const writeTools =
  /^(edit|write|multiedit|notebookedit|apply_patch|patch|str_replace|create_file|file\.(write|edit|create|move|rename|delete)|fs_write|replace)/i;

export function writesFile(toolName: string): boolean {
  const name = toolName.replace(/^mcp__[^_]+__/, "");
  return writeTools.test(name) || /(^|[._-])(edit|write|patch)([._-]|$)/i.test(name);
}

const ended = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

export function nextRunWork(
  known: RunWork | undefined,
  event: AiInvocationEvent,
  now: number,
): RunWork | undefined {
  if (ended.has(event.type)) return undefined;
  const work: RunWork = known ? { ...known, at: now } : { tool: "", at: now, writes: {} };
  if (event.type === "tool.started") {
    work.tool = event.toolName;
    if (event.path && writesFile(event.toolName)) {
      work.writes = { ...work.writes, [event.path]: now };
    }
  }
  return work;
}

export function relativeToFolders(path: string, folders: readonly string[]): string | undefined {
  const clean = path.replace(/\\/g, "/");
  if (!clean.startsWith("/") && !/^[a-z]:\//i.test(clean)) {
    const rel = clean.replace(/^\.\//, "");
    return rel && !rel.split("/").includes("..") ? rel : undefined;
  }
  for (const folder of folders) {
    const root = folder.replace(/\\/g, "/").replace(/\/+$/, "");
    if (clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
  }
  return undefined;
}

export function claimedFiles(
  work: RunWork | undefined,
  folders: readonly string[],
  now: number,
): string[] {
  if (!work || now - work.at > claimIdleMs) return [];
  const files: string[] = [];
  for (const [path] of Object.entries(work.writes).sort((a, b) => b[1] - a[1])) {
    const rel = relativeToFolders(path, folders);
    if (rel && !files.includes(rel)) files.push(rel);
    if (files.length === maxClaimedFiles) break;
  }
  return files;
}

export const useRunWork = create<{ runs: Record<string, RunWork> }>(() => ({ runs: {} }));

let watching = false;

export function followRunWork(): void {
  if (watching) return;
  watching = true;
  watchAllRunEvents((runId, event) => {
    const runs = useRunWork.getState().runs;
    const known = runs[runId];
    const work = nextRunWork(known, event, Date.now());
    if (work === known) return;
    const next = { ...runs };
    if (work) next[runId] = work;
    else delete next[runId];
    useRunWork.setState({ runs: next });
  });
}
