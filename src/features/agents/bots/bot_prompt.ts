// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { AgentProfile } from "@/shared/schemas";

export const PROSE_LIMIT = 10_000;

type PromptBlockId = "identity" | "soul" | "instructions";

interface PromptBlock {
  id: PromptBlockId;
  title: string;
  text: string;
  chars: number;
  omitted: boolean;
  preview: string;
}

interface AssembledPrompt {
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

function identityText(agent: Pick<AgentProfile, "name" | "role" | "description">) {
  const lines = [`You are ${agent.name}.`];
  if (agent.role?.trim()) lines.push(`Title: ${agent.role.trim()}`);
  if (agent.description?.trim()) lines.push(`About: ${agent.description.trim()}`);
  return lines.join("\n");
}

export function assembleAgentPrompt(input: {
  agent: PromptAgent;
  quiet?: boolean;
}): AssembledPrompt {
  const { agent, quiet = false } = input;
  const voiced = !quiet && Boolean(agent.soul?.trim());
  const drafts: { id: PromptBlockId; title: string; body: string }[] = [
    { id: "identity", title: "Who you are", body: voiced ? identityText(agent) : "" },
    { id: "soul", title: "Your soul", body: voiced ? (agent.soul ?? "").trim() : "" },
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
  const text = voiced
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

export function proseOverLimit(agent: { soul?: string; instructions?: string }) {
  return countChars(agent.soul ?? "") + countChars(agent.instructions ?? "") > PROSE_LIMIT;
}

export function duplicateProseLines(agent: { soul?: string; instructions?: string }) {
  const normalize = (line: string) => line.replace(/^[-*\d.\s]+/, "").trim();
  const significant = (line: string) => line.length >= 6;
  const soul = new Set((agent.soul ?? "").split("\n").map(normalize).filter(significant));
  return (agent.instructions ?? "")
    .split("\n")
    .map(normalize)
    .filter((line) => significant(line) && soul.has(line));
}
