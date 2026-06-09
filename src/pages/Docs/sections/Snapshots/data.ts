import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "snapshots",
  label: "Reviewing snapshots",
  category: "backups",
  title: "Reviewing snapshots",
  prose: `Snapshots are the core unit of a backup in Misty. Each one captures a point in time that you can return to later.

This is useful for version recovery, accidental deletes, or simply having a reliable checkpoint before you make large changes.

The best way to trust snapshots is to create one early and make sure you understand how it appears in the app.`,
  notes: [],
};
