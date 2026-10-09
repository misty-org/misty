import { command } from "./factory";

// Focus mode, tab and page commands for the browser.
export const focusModeCommands = [
  command("app.toggle_focus_mode", "Toggle focus mode", {
    description: "Hide the navigation and tab strip so pages fill the window.",
    category: "View",
    aliases: ["hide sidebar", "hide tabs", "distraction free", "fullscreen"],
    mac: "Cmd+Shift+S",
    windows: "Ctrl+Shift+S",
    allowInEditable: true,
    nativeMenu: true,
  }),
];

export const tabFeatureCommands = [
  command("workspace.toggle_pin_tab", "Pin or unpin tab", {
    description: "Pin the current web page so it stays first and returns here when closed.",
    category: "Tabs and panes",
    scope: "workspace",
    aliases: ["pin tab", "unpin tab", "keep tab"],
    mac: null,
    windows: null,
    allowInEditable: true,
  }),
  command("workspace.search_tabs", "Search open tabs", {
    description: "List the open tabs in every virtual window and switch to one.",
    category: "Tabs and panes",
    scope: "workspace",
    aliases: ["tab search", "switch tab", "find tab", "open tabs"],
    mac: "Cmd+Shift+A",
    windows: "Ctrl+Shift+A",
    allowInEditable: true,
    nativeMenu: true,
  }),
];

export const browserFeatureCommands = [
  command("browser.translate", "Translate page", {
    description: "Ask Misty to translate the page into your language beside it.",
    category: "Browser",
    scope: "tool:browser",
    aliases: ["translate", "language"],
    mac: null,
    windows: null,
    allowInEditable: true,
  }),
  command("browser.reader_mode", "Reader view", {
    description: "Show the page's article in a clean, readable layout, or return to the page.",
    category: "Browser",
    scope: "tool:browser",
    aliases: ["reader", "reading mode", "article"],
    mac: "Cmd+Shift+R",
    windows: null,
    allowInEditable: true,
  }),
  command("browser.picture_in_picture", "Picture in picture", {
    description: "Play the page's video in a floating window, or bring it back.",
    category: "Browser",
    scope: "tool:browser",
    aliases: ["pip", "floating video", "mini player"],
    mac: "Cmd+Option+P",
    windows: "Ctrl+Alt+P",
    linux: null,
    allowInEditable: true,
  }),
];
