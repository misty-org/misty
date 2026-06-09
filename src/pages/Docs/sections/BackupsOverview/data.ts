import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "backups-overview",
  label: "Creating backups",
  category: "backups",
  title: "Creating backups",
  prose: `Backups in Misty are built around Vault, which uses restic under the hood to create encrypted snapshots of local or remote folders.

The goal is to make backups feel like part of the same file workflow instead of a separate tool. You can create snapshots, restore older versions, and manage backup targets without leaving the app.

A good starting point is backing up one important folder first. Once you trust the flow, you can expand into broader backup jobs and longer retention strategies.`,
  notes: [
    {
      kind: "tip",
      text: "Test a restore early. A backup system feels much more trustworthy once you have verified that restores work the way you expect.",
    },
  ],
};
