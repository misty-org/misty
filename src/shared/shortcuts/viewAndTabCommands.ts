import { command } from "./factory";

// Focus mode and tab commands.
export const focusModeCommands = [
  command("app.toggle_focus_mode", "Toggle focus mode", {
    description: "Hide the sidebar so pages fill the window.",
    category: "View",
    aliases: ["hide sidebar", "hide tabs", "distraction free", "fullscreen"],
    mac: "Cmd+Shift+S",
    windows: "Ctrl+Shift+S",
    allowInEditable: true,
    nativeMenu: true,
  }),
];

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
