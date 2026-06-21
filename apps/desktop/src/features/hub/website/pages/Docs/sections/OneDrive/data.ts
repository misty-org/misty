import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "onedrive",
  label: "Configuring OneDrive",
  category: "providers",
  title: "Configuring OneDrive",
  prose: `OneDrive works well for Microsoft heavy workflows where documents, team folders, and Office collaboration matter most.

Misty keeps that structure readable while giving you the same browsing and search flow you get with every other provider.

If you use both personal and work accounts, connect them one at a time so it stays obvious which libraries you want visible.`,
  notes: [
    {
      kind: "note",
      text: "Some organization managed accounts may require an approval step before the provider appears fully.",
    },
  ],
};
