import type { UndoResult } from "../../store/useAgentsStore";

/** What undoing a run did, in plain words. */
export function undoneText(name: string, result: UndoResult): string {
  const pushed = result.commitsPushed
    ? ` Its ${result.commitsPushed === 1 ? "commit was" : `${result.commitsPushed} commits were`} already pushed, so ${
        result.commitsPushed === 1 ? "it stays" : "they stay"
      }; only the files went back.`
    : "";
  return `Changes to ${name} undone.${pushed}`;
}

/** A failure from the device, shown as is when it's already plain language. */
export function plainFailure(problem: unknown, fallback: string): string {
  const text =
    typeof problem === "string" ? problem : problem instanceof Error ? problem.message : "";
  return text && !text.includes("_") ? text : fallback;
}
