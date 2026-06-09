import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "search-overview",
  label: "Searching across files",
  category: "search",
  title: "Searching across files",
  prose: `Search is one of Misty's core strengths. Instead of checking each provider separately, you can ask one question and search across all the storage you have connected.

That makes Misty useful even before you move many files around. For a lot of people, the first big win is simply finding the right file without remembering which provider it lives in.

Once your first index is built, search becomes the quickest way to validate that your setup is working the way it should.`,
  notes: [
    {
      kind: "tip",
      text: "A single connected provider is enough to test the search experience. You can scale up once you are happy with the results.",
    },
  ],
};
