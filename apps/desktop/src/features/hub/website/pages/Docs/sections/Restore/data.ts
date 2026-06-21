import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "restore",
  label: "Restoring files",
  category: "backups",
  title: "Restoring files",
  prose: `A restore flow matters more than the backup itself. Misty is designed to make it easy to browse older points in time and bring files back without leaving the app.

For important workflows, test restores early instead of waiting for a stressful moment to learn how the process works.

Once you know restores behave the way you expect, the backup system becomes much more trustworthy.`,
  notes: [
    {
      kind: "tip",
      text: "Always test at least one restore before you rely on any backup setup long term.",
    },
  ],
};
