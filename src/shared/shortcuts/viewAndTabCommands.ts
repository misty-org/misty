import { command } from "./factory";

// Tab commands.
export const tabFeatureCommands = [
  command("workspace.clear_tabs", "Clear tabs", {
    description: "Close every tab except the one you are on.",
    category: "Tabs",
    scope: "workspace",
    aliases: ["clear", "close other tabs", "tidy tabs", "close all tabs"],
    mac: null,
    windows: null,
    allowInEditable: true,
  }),
];
