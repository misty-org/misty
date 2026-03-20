import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "setup",
  label: "Setup",
  category: "getting-started",
  title: "Setup",
  prose: `After installation, the fastest path is to sign in, connect one provider, and let Misty build its first index in the background.

You can expand later into multiple providers, backups, plugins, or remote access workflows without having to redo the initial setup.

If you are migrating from another workflow, start small and verify the basics first.`,
  notes: [
    {
      kind: "tip",
      text: "Confirm browsing, uploads, and search feel right with one provider before adding the rest of your storage.",
    },
  ],
};
