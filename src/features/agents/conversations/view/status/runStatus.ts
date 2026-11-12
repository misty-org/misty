// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { AiProgressItem } from "../../../runs/invocations/invocationTypes";
import { stepTarget, toolParts, type ProgressTool } from "../../../progress/progressTimeline";
import {
  createEditLineStatsBuilder,
  editPath,
  isEditToolName,
  type EditLineStat,
} from "../../../progress/payload/editLineStats";
import type { GlobalAiMessage } from "../../state/conversationTypes";

const live = (message: GlobalAiMessage) =>
  message.state === "pending" || message.state === "streaming";

/** The reply the strip reports on: the latest one. */
export function latestReply(messages: GlobalAiMessage[]): GlobalAiMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--)
    if (messages[index].role === "assistant") return messages[index];
  return undefined;
}

/** What a running reply is doing now, in the timeline's words ("Reading src/a.ts"). */
export function liveStep(reply: GlobalAiMessage | undefined): string | undefined {
  if (!reply || !live(reply)) return undefined;
  const running = [...(reply.progress ?? [])]
    .reverse()
    .find((item): item is ProgressTool => item.type === "tool" && item.state === "running");
  if (running) return `${toolParts(running.name, true).verb} ${stepTarget(running)}`.trim();
  return reply.activity && !/^[a-z_]+$/.test(reply.activity) ? reply.activity : undefined;
}

export interface EditedFile {
  path: string;
  stat?: EditLineStat;
}

/**
 * The files a chat's edit calls changed, first edit first, with +/- counts from the calls' own
 * arguments. Counts freeze between runs and grow when a new run edits again. Builds once per
 * caller; unchanged calls reuse their counts.
 */
export function createEditedFilesBuilder() {
  const stats = createEditLineStatsBuilder();
  return (messages: GlobalAiMessage[]) => {
    const calls = messages.flatMap((message) =>
      (message.progress ?? []).filter(
        (item): item is Extract<AiProgressItem, { type: "tool" }> =>
          item.type === "tool" && item.state !== "failed" && isEditToolName(item.name),
      ),
    );
    const perFile = stats(calls);
    const seen = new Set<string>();
    const files: EditedFile[] = [];
    for (const call of calls) {
      const path = editPath(call);
      if (!path || seen.has(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue;
      seen.add(path);
      files.push({ path, stat: perFile.get(path) });
    }
    const total = files.reduce<EditLineStat | null>(
      (sum, file) =>
        file.stat
          ? {
              additions: (sum?.additions ?? 0) + file.stat.additions,
              deletions: (sum?.deletions ?? 0) + file.stat.deletions,
            }
          : sum,
      null,
    );
    return { files, total };
  };
}
