import type { AiSuggestedAction } from "@/features/agents";

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
