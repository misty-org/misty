import { command } from "./factory";

export const roadmapShortcutCommands = [
  command("roadmap.create", "Create Roadmap item", {
    description: "Create an item in the focused Roadmap.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "N",
    windows: "N",
  }),
  command("roadmap.copy", "Copy Roadmap item", {
    description: "Copy the selected Roadmap item.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Cmd+C",
    windows: "Ctrl+C",
  }),
  command("roadmap.paste", "Paste Roadmap item", {
    description: "Paste a copied Roadmap item.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Cmd+V",
    windows: "Ctrl+V",
  }),
  command("roadmap.duplicate", "Duplicate Roadmap item", {
    description: "Duplicate the selected Roadmap item.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Cmd+D",
    windows: "Ctrl+D",
  }),
  command("roadmap.undo", "Undo Roadmap edit", {
    description: "Undo the last Roadmap edit.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Cmd+Z",
    windows: "Ctrl+Z",
    allowShadowing: true,
  }),
  command("roadmap.redo", "Redo Roadmap edit", {
    description: "Redo the last Roadmap edit.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Cmd+Shift+Z",
    windows: "Ctrl+Y",
    allowShadowing: true,
  }),
  command("roadmap.delete", "Delete Roadmap item", {
    description: "Delete the selected Roadmap item.",
    category: "Roadmap",
    scope: "tool:roadmap",
    mac: "Delete",
  }),
];
