import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "google-drive",
  label: "Configuring Google Drive",
  category: "providers",
  title: "Configuring Google Drive",
  prose: `Google Drive is usually the easiest provider to start with because the auth flow is familiar and shared folders are common.

It is a good choice when you want to validate that search, previews, and transfers all feel solid before expanding into more complex setups.

If you rely on shared drives, connect a personal account first, then expand into workspace resources once your baseline feels stable.`,
  notes: [
    {
      kind: "tip",
      text: "Use Google Drive as your first provider if you want the smoothest initial setup.",
    },
  ],
};
