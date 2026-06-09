import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "mistyai-overview",
  label: "Asking MistyAI",
  category: "mistyai",
  title: "Asking MistyAI",
  prose: `MistyAI adds a conversational layer on top of your files so you can ask questions, find content faster, and trigger actions without manually digging through folders.

The value is not just chat for the sake of chat. It is about understanding your working directory, your connected storage, and the context around the files you already manage in Misty.

For many workflows, MistyAI becomes the quickest way to move from a vague question to a concrete action.`,
  notes: [
    {
      kind: "tip",
      text: "Try using MistyAI for discovery first. Asking it to find, summarize, or narrow down files is often the fastest way to build trust in the workflow.",
    },
  ],
};
