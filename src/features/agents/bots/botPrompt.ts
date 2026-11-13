// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * An agent's part of a run's instructions, built from its bot fields: who it is, its soul, its
 * working rules. One pure function serves both the run and the editor's
 * preview, so what the person reads is what the engine gets. Block order is fixed and empty blocks
 * are left out whole.
 */
import type { AgentProfile } from "@/shared/schemas";

/** SOUL and AGENTS share this budget; the editor warns above it. */
export const PROSE_LIMIT = 10_000;

export type PromptBlockId = "identity" | "soul" | "instructions";

export interface PromptBlock {
  id: PromptBlockId;
  title: string;
  text: string;
  chars: number;
  omitted: boolean;
  /** The first line with text, for the preview's one-line summary. */
  preview: string;
}

export interface AssembledPrompt {
  blocks: PromptBlock[];
  text: string;
  totalChars: number;
}

type PromptAgent = Pick<AgentProfile, "name" | "role" | "description" | "instructions"> &
  Partial<Pick<AgentProfile, "soul">>;

const countChars = (text: string) => [...text].length;

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

/** Who the agent is: what it reads to know itself. Only the parts it has are listed. */
export function identityText(agent: Pick<AgentProfile, "name" | "role" | "description">) {
  const lines = [`You are ${agent.name}.`];
  if (agent.role?.trim()) lines.push(`Title: ${agent.role.trim()}`);
  if (agent.description?.trim()) lines.push(`About: ${agent.description.trim()}`);
  return lines.join("\n");
}

export function assembleAgentPrompt(input: { agent: PromptAgent }): AssembledPrompt {
  const { agent } = input;
  const drafts: { id: PromptBlockId; title: string; body: string }[] = [
    { id: "identity", title: "Who you are", body: agent.soul?.trim() ? identityText(agent) : "" },
    { id: "soul", title: "Your soul", body: (agent.soul ?? "").trim() },
    { id: "instructions", title: "How you work", body: (agent.instructions ?? "").trim() },
  ];
  const blocks = drafts.map((draft) => ({
    id: draft.id,
    title: draft.title,
    text: draft.body,
    chars: countChars(draft.body),
    omitted: draft.body.length === 0,
    preview: firstLine(draft.body),
  }));
  // An agent with no soul keeps its instructions exactly as written, as before bots.
  const text = agent.soul?.trim()
    ? blocks
        .filter((block) => !block.omitted)
        .map((block) => `# ${block.title}\n${block.text}`)
        .join("\n\n")
    : blocks
        .filter((block) => !block.omitted)
        .map((block) =>
          block.id === "instructions" ? block.text : `# ${block.title}\n${block.text}`,
        )
        .join("\n\n");
  return { blocks, text, totalChars: countChars(text) };
}

/** Whether SOUL and AGENTS together are over their shared budget. */
export function proseOverLimit(agent: { soul?: string; instructions?: string }) {
  return countChars(agent.soul ?? "") + countChars(agent.instructions ?? "") > PROSE_LIMIT;
}

/**
 * Lines that appear in both the soul and the instructions: the model reads them twice, so the
 * editor suggests keeping each in one place. Lines under six characters are ignored.
 */
export function duplicateProseLines(agent: { soul?: string; instructions?: string }) {
  const normalize = (line: string) => line.replace(/^[-*\d.\s]+/, "").trim();
  const significant = (line: string) => line.length >= 6;
  const soul = new Set((agent.soul ?? "").split("\n").map(normalize).filter(significant));
  return (agent.instructions ?? "")
    .split("\n")
    .map(normalize)
    .filter((line) => significant(line) && soul.has(line));
}
