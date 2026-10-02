import type { AiSuggestedAction } from "@/features/ai-surface/types";

/** Actions the AI pane offers for an open Space conversation. */
export const spaceChatSuggestedActions: AiSuggestedAction[] = [
  {
    id: "recap",
    label: "Recap",
    prompt:
      "Recap the recent conversation with decisions, open questions, and important context. Cite the conversation.",
  },
  {
    id: "decisions",
    label: "Decisions",
    prompt: "Extract decisions and explain the evidence for each one.",
  },
  {
    id: "action-items",
    label: "Action items",
    prompt:
      "Extract a reviewed set of actionable Space tasks from this conversation. Do not invent owners or due dates.",
    requestedArtifactKind: "task_set",
  },
  {
    id: "draft-message",
    label: "Draft message",
    prompt: "Draft a concise message for this exact Space conversation. Do not post it.",
    requestedArtifactKind: "message_draft",
  },
  {
    id: "explain-thread",
    label: "Explain thread",
    prompt:
      "Explain this conversation to someone joining now, distinguishing facts from inference.",
  },
];
