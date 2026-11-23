import type { AiProgressItem } from "../runs/invocations/invocation_types";
import type { EngineTurn } from "../conversations/view/engine/engine_turn_store";
import { countEditLines, parseEditArgs } from "./payload/edit_line_stats";
import { stepTarget, toolKind, toolParts } from "./progress_timeline";

export type TurnChangeFile = { path: string; added: number; removed: number };

export function turnChanges(items: AiProgressItem[] | undefined): TurnChangeFile[] {
  const files = new Map<string, TurnChangeFile>();
  for (const item of items ?? []) {
    if (item.type !== "tool" || item.state !== "completed" || toolKind(item.name) !== "edit")
      continue;
    const path = item.path ?? parseEditArgs(item.args)?.filePath;
    if (!path) continue;
    const lines = countEditLines(item.args);
    const file = files.get(path) ?? { path, added: 0, removed: 0 };
    file.added += lines?.additions ?? 0;
    file.removed += lines?.deletions ?? 0;
    files.set(path, file);
  }
  return [...files.values()];
}

export function turnPhrase(props: {
  progress: AiProgressItem[] | undefined;
  engine: EngineTurn | undefined;
  writing: boolean;
  waitingOnApp?: boolean;
}): { phrase: string; waiting: boolean } {
  const { engine } = props;
  if (props.waitingOnApp || engine?.asks.some((ask) => !ask.settled))
    return { phrase: "Waiting for you", waiting: true };
  if (engine?.plan?.complete && engine.plan.status === "awaiting_review")
    return { phrase: "Waiting for you to review the plan", waiting: true };
  if (engine?.retry)
    return {
      phrase: `Retrying, attempt ${engine.retry.attempt}${engine.retry.max ? ` of ${engine.retry.max}` : ""}`,
      waiting: false,
    };
  if (engine?.compacting) return { phrase: "Compacting the conversation", waiting: false };
  const running = [...(props.progress ?? [])]
    .reverse()
    .find((item) => item.type === "tool" && item.state === "running");
  if (running?.type === "tool") {
    const { verb, subject } = toolParts(running.name, true);
    const target = stepTarget(running) || subject;
    return { phrase: target ? `${verb} ${target}` : verb, waiting: false };
  }
  if (engine?.background)
    return {
      phrase: `Waiting for ${engine.background} background ${engine.background === 1 ? "task" : "tasks"}`,
      waiting: false,
    };
  return { phrase: props.writing ? "Writing" : "Thinking", waiting: false };
}
