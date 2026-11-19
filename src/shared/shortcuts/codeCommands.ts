import { command } from "./factory";

/** The Code page's commands. Each works only while the page is in view. */
export const codeCommands = [
  command("code.quick_open", "Quick open", {
    description: "Find a file in the Code page's folder by name and open it.",
    category: "Code",
    scope: "workspace",
    aliases: ["go to file", "open file", "find file"],
    mac: "Cmd+P",
    windows: "Ctrl+P",
    allowInEditable: true,
  }),
  command("code.search_text", "Search in files", {
    description: "Find text across the Code page's folder.",
    category: "Code",
    scope: "workspace",
    aliases: ["find in files", "grep", "search folder"],
    mac: "Cmd+Shift+F",
    windows: "Ctrl+Shift+F",
    allowInEditable: true,
  }),
  command("code.toggle_terminal", "Show or hide the terminal", {
    description: "Open or close the terminal under the Code page's editor.",
    category: "Code",
    scope: "workspace",
    aliases: ["terminal", "shell", "console"],
    mac: "Ctrl+Grave",
    windows: "Ctrl+Grave",
    allowInEditable: true,
  }),
  command("code.toggle_sidebar", "Show or hide the sidebar", {
    description: "Open or close the Code page's files, changes, live and databases column.",
    category: "Code",
    scope: "workspace",
    aliases: ["sidebar", "explorer", "file tree"],
    mac: "Cmd+B",
    windows: "Ctrl+B",
    allowInEditable: true,
  }),
];
