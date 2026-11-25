import { command } from "./factory";

export const chatCommands = [
  command("app.command_palette", "Search", {
    description: "Find chats, Space content, apps and settings, or run a command.",
    category: "Misty",
    aliases: ["commands", "palette", "run command", "find", "search"],
    mac: "Cmd+K",
    windows: "Ctrl+K",
    allowInEditable: true,
    allowShadowing: true,
  }),
  command("chat.search", "Search in chat", {
    description: "Find text in this chat, with next and previous.",
    category: "Chat",
    scope: "workspace",
    aliases: ["find", "search messages"],
    mac: "Cmd+F",
    windows: "Ctrl+F",
    allowInEditable: true,
    allowShadowing: true,
  }),
  command("chat.focus_composer", "Focus message box", {
    description: "Put the cursor in this chat's message box.",
    category: "Chat",
    scope: "workspace",
    aliases: ["compose", "type a message"],
    mac: "Cmd+L",
    windows: "Ctrl+L",
    allowInEditable: true,
    allowShadowing: true,
  }),
  command("chat.stop_run", "Stop the reply", {
    description: "Stop the run answering in this chat.",
    category: "Chat",
    scope: "workspace",
    aliases: ["cancel", "interrupt"],
    allowInEditable: true,
  }),
];
