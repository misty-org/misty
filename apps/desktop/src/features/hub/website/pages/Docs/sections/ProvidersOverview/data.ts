import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "providers-overview",
  label: "Connecting accounts",
  category: "providers",
  title: "Connecting accounts",
  prose: `Misty is designed to make different storage providers feel consistent. You can browse, search, upload, and organize files from one interface even when the providers themselves work very differently.

Google Drive and OneDrive are usually the easiest places to begin. S3 and Sftp are a better fit when your files live closer to servers, backups, or infrastructure workflows.

You do not need to connect every provider at once. Start with the one you already rely on most, then expand once the flow feels good.`,
  notes: [
    {
      kind: "tip",
      text: "If you are new to Misty, connect a familiar provider first so you can validate search, previews, and transfers before expanding.",
    },
  ],
};
