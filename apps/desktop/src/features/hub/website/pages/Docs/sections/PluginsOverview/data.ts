import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "plugins-overview",
  label: "Installing plugins",
  category: "plugins",
  title: "Installing plugins",
  prose: `Plugins let you extend Misty beyond basic file browsing. The idea is to make custom workflows feel native to the app instead of forcing everything through one fixed interface.

That can mean automation, internal tools, custom panels, or workflows that tie together cloud storage, local files, and your own systems.

The plugin system is meant to keep Misty flexible. You can start simple, then gradually shape the app around the way you actually work.`,
  notes: [
    {
      kind: "note",
      text: "A good plugin usually solves one clear workflow first. It is better to start narrow and useful than broad and vague.",
    },
  ],
};
