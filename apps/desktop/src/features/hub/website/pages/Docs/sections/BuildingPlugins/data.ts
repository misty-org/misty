import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "building-plugins",
  label: "Building plugins",
  category: "plugins",
  title: "Building plugins",
  prose: `A strong plugin usually starts with one clear workflow. It does not need to solve everything at once.

The best way to build for Misty is to begin with a narrow use case that already matters to you, then grow from there as the workflow proves itself.

That keeps plugins useful, understandable, and easier to maintain over time.`,
  notes: [
    {
      kind: "note",
      text: "Start small and useful. A focused plugin almost always lands better than a broad one.",
    },
  ],
};
