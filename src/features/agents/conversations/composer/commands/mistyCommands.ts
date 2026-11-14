import { invoke } from "@/native/invoke";
import { pickSaveFile } from "@/native/sandbox";
import { engineModels, modelNamed } from "../../../engines/enginesApi";
import { engineModesFor } from "../../../engines/engineModes";
import { agentAccountId } from "../../../personal/agentAccount";
import { chooseEngineMode } from "../../../plans/permissionMode";
import { chatUsage, formatCost } from "../../../context-panel/chatUsage";
import { forkChat } from "../../state/chatOrganizing";
import { useMistyStore } from "../../state/useMistyStore";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { requestFolderGrant } from "../../view/grants/folderGrants";
import { useComposerChoices } from "../controls/composerChoices";
import { useComposerVim } from "../controls/composerVim";
import { useCommandReport, type CommandSection } from "./commandOutput";
import { done, openControl, settings, showPanel, type MistyCommand } from "./commandKit";
import { goalCommands } from "./goalCommands";

export {
  done,
  openControl,
  settings,
  showPanel,
  type CommandScope,
  type CommandSend,
  type MistyCommand,
  type Ran,
} from "./commandKit";

/**
 * Misty's own versions of what an engine only does in its terminal app (`/model`, `/cost`,
 * `/copy`, `/export`…), and the pieces of the composer they reach. `engineCommands.ts` decides
 * when one of them runs instead of the engine's own.
 */

const replies = (messages: GlobalAiMessage[]) =>
  messages.filter((message) => message.role === "assistant" && message.content.trim());

const tokens = (count: number) => count.toLocaleString();

/** The chat as Markdown, the way an engine's `/export` writes it. */
function transcript(title: string, messages: GlobalAiMessage[]) {
  const turns = messages
    .filter((message) => message.content.trim())
    .map(
      (message) =>
        `## ${message.role === "user" ? "You" : "Assistant"}\n\n${message.content.trim()}`,
    );
  return `# ${title || "Conversation"}\n\n${turns.join("\n\n")}\n`;
}

function usageSections(messages: GlobalAiMessage[]): CommandSection[] {
  const usage = chatUsage(messages.map((message) => message.usage));
  const rows = [
    { label: "Replies", value: String(usage.replies) },
    { label: "Tokens in", value: tokens(usage.totalIn) },
    { label: "Tokens out", value: tokens(usage.totalOut) },
  ];
  if (usage.costUsd !== undefined) rows.push({ label: "Cost", value: formatCost(usage.costUsd) });
  return [
    { heading: "This chat", rows },
    { text: "Plan limits for each engine are in Settings › Engines › Usage." },
  ];
}

function contextSections(messages: GlobalAiMessage[]): CommandSection[] {
  const usage = chatUsage(messages.map((message) => message.usage));
  if (!usage.used) return [{ text: "The engine hasn't reported its context yet in this chat." }];
  const rows = [{ label: "In use", value: `${tokens(usage.used)} tokens` }];
  if (usage.window) {
    rows.push({ label: "Window", value: `${tokens(usage.window)} tokens` });
    rows.push({ label: "Full", value: `${Math.round((usage.used / usage.window) * 100)}%` });
  }
  const last = usage.last;
  const buckets = last
    ? [
        { label: "Input", value: last.input },
        { label: "Output", value: last.output },
        { label: "Cache read", value: last.cacheRead },
        { label: "Cache write", value: last.cacheWrite },
      ]
        .filter((bucket) => typeof bucket.value === "number")
        .map((bucket) => ({ label: bucket.label, value: tokens(bucket.value as number) }))
    : [];
  return [
    { heading: "Context", rows },
    ...(buckets.length ? [{ heading: "Latest reply", rows: buckets }] : []),
  ];
}

export const mistyCommands: readonly MistyCommand[] = [
  ...goalCommands,
  {
    name: "new",
    description: "Start a new chat with this agent",
    on: "all",
    wins: "always",
    run: (_args, scope) => {
      scope.newChat?.();
      return null;
    },
  },
  {
    name: "clear",
    aliases: ["reset"],
    description: "Start the engine's next turn in a new session",
    on: "outside",
    wins: "always",
    run: async (_args, scope) => {
      if (!scope.conversationId) return null;
      await invoke("engine_chat_clear", {
        account: agentAccountId(),
        conversation: scope.conversationId,
      });
      return done("The next message starts a new session");
    },
  },
  {
    name: "resume",
    aliases: ["sessions", "continue"],
    description: "Continue one of the engine's earlier sessions here",
    on: "outside",
    wins: "bare",
    run: (_args, scope) => {
      scope.openHistory();
      return null;
    },
  },
  {
    name: "plan",
    description: "Switch to Plan and send what follows",
    hint: "[task]",
    on: "all",
    // `/plan open` shows the engine's own plan where it has one (Claude Code's).
    // Hermes plans with its own `/plan` and has no planning mode to switch to.
    wins: (args, engine) => engine !== "hermes" && args.trim().toLowerCase() !== "open",
    run: async (args, scope) => {
      const rest = await scope.plan(`/plan ${args}`.trim());
      return rest ? { send: rest } : null;
    },
  },
  {
    name: "model",
    description: "Choose the model, or switch to one by name",
    hint: "[model]",
    on: "outside",
    wins: "always",
    run: async (args, scope) => {
      if (!args) return openControl("model");
      const models = await engineModels(scope.engine);
      const wanted = args.toLowerCase();
      const model =
        modelNamed(models, args) ??
        models.find((item) => item.label.toLowerCase() === wanted) ??
        models.find(
          (item) =>
            item.id.toLowerCase().includes(wanted) || item.label.toLowerCase().includes(wanted),
        );
      if (!model) return done(`This engine has no model called “${args}”`);
      useComposerChoices
        .getState()
        .choose(scope.accountId, scope.conversationId, { model: model.id });
      return done(`The next message uses ${model.label}`);
    },
  },
  {
    name: "effort",
    aliases: ["thinking", "reasoning"],
    description: "Choose how hard the model thinks",
    hint: "[level]",
    on: "outside",
    wins: "always",
    run: (args, scope) => {
      if (!args) return openControl("model");
      useComposerChoices.getState().choose(scope.accountId, scope.conversationId, {
        effort: args.toLowerCase(),
      });
      return done(`The next message thinks at ${args.toLowerCase()}`);
    },
  },
  {
    name: "fast",
    description: "Turn the engine's fast mode on or off",
    on: "outside",
    // Hermes switches its own fast mode.
    wins: (_args, engine) => engine !== "hermes",
    run: () => openControl("model"),
  },
  {
    name: "permissions",
    aliases: ["mode", "approvals"],
    description: "Choose how the engine asks before it acts",
    hint: "[mode]",
    on: "all",
    wins: "always",
    run: async (args, scope) => {
      if (!args) return openControl("mode");
      const modes = await engineModesFor(scope.engine);
      const wanted = args.toLowerCase();
      const mode = modes.find(
        (item) => item.id.toLowerCase() === wanted || item.label.toLowerCase() === wanted,
      );
      if (!mode) return done(`This engine has no mode called “${args}”`);
      await chooseEngineMode(scope.conversationId, mode);
      return done(`The next message runs in ${mode.label}`);
    },
  },
  {
    name: "mcp",
    aliases: ["mcps"],
    description: "Manage MCP servers",
    on: "all",
    wins: "bare",
    run: () => settings("engine-mcp"),
  },
  {
    name: "usage",
    aliases: ["cost", "stats"],
    description: "Show this chat's tokens and cost",
    on: "all",
    run: (_args, scope) => {
      useCommandReport.getState().show({ title: "Usage", sections: usageSections(scope.messages) });
      return null;
    },
  },
  {
    name: "context",
    description: "Show how full the context window is",
    on: "all",
    run: (_args, scope) => {
      useCommandReport
        .getState()
        .show({ title: "Context", sections: contextSections(scope.messages) });
      return null;
    },
  },
  {
    name: "status",
    aliases: ["session"],
    description: "Show this chat's engine, model, mode and folder",
    on: "all",
    run: async (_args, scope) => {
      const choices = useComposerChoices.getState();
      const chosen = scope.conversationId
        ? choices.byConversation[scope.conversationId]
        : choices.draft;
      const modes = await engineModesFor(scope.engine);
      const rows = [
        { label: "Engine", value: scope.engine || "Misty" },
        ...(chosen?.model ? [{ label: "Model", value: chosen.model }] : []),
        ...(chosen?.effort ? [{ label: "Effort", value: chosen.effort }] : []),
        ...(modes.length
          ? [{ label: "Modes", value: modes.map((mode) => mode.label).join(", ") }]
          : []),
        { label: "Folder", value: scope.folder || "None linked" },
      ];
      useCommandReport.getState().show({
        title: "Status",
        sections: [{ rows }, ...contextSections(scope.messages)],
      });
      return null;
    },
  },
  {
    name: "diff",
    description: "Show the changes in this chat's folder",
    on: "all",
    run: () => showPanel("changes"),
  },
  {
    name: "copy",
    description: "Copy the latest reply, or the Nth latest",
    hint: "[n]",
    on: "all",
    wins: "always",
    run: async (args, scope) => {
      const list = replies(scope.messages);
      const back = Math.max(1, Number.parseInt(args, 10) || 1);
      const reply = list[list.length - back];
      if (!reply) return done("There is no reply to copy yet");
      await navigator.clipboard.writeText(reply.content);
      return done(back === 1 ? "Copied the latest reply" : `Copied reply ${back} from the end`);
    },
  },
  {
    name: "export",
    aliases: ["save"],
    description: "Save this chat as a Markdown file",
    hint: "[file name]",
    on: "all",
    run: async (args, scope) => {
      const chat = useMistyStore
        .getState()
        .conversations.find((conversation) => conversation.id === scope.conversationId);
      const title = chat?.title ?? "Conversation";
      const name = args || `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Conversation"}.md`;
      const path = await pickSaveFile({
        defaultName: name,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return null;
      // The native side writes only to the file just chosen in the save dialog.
      await invoke("engine_performance_export", {
        path,
        content: transcript(title, scope.messages),
      });
      return done("Saved the chat");
    },
  },
  {
    name: "rename",
    aliases: ["title", "name"],
    description: "Rename this chat",
    hint: "<title>",
    on: "all",
    run: async (args, scope) => {
      if (!scope.conversationId) return null;
      if (!args) return done("Type a title after /rename");
      await useMistyStore.getState().renameConversation(scope.conversationId, args);
      return null;
    },
  },
  {
    name: "fork",
    aliases: ["branch"],
    description: "Copy this chat into a new one",
    hint: "[message]",
    on: "all",
    run: (args, scope) => {
      if (!scope.conversationId) return null;
      const copy = forkChat(scope.conversationId);
      if (!copy) return null;
      useMistyStore.getState().selectConversation(copy);
      return args ? { send: args, conversationId: copy } : null;
    },
  },
  {
    name: "cd",
    description: "Change the folder this chat works in",
    on: "outside",
    wins: "always",
    run: () => showPanel("session"),
  },
  {
    name: "add-dir",
    description: "Let the engine work in another folder too",
    hint: "<path>",
    on: "outside",
    wins: "always",
    run: async (args) => {
      if (!args) return showPanel("session");
      const folder = await requestFolderGrant(args);
      return folder ? done(`The engine can now work in ${folder}`) : null;
    },
  },
  {
    name: "tasks",
    aliases: ["todos", "agents", "subagents", "bashes"],
    description: "Show the run's steps and background work",
    on: "all",
    run: () => showPanel("steps"),
  },
  {
    name: "stop",
    aliases: ["exit", "quit"],
    description: "Stop the running turn",
    on: "all",
    wins: "always",
    run: async (_args, scope) => {
      if (!scope.working) return done("Nothing is running");
      await scope.stop();
      return null;
    },
  },
  {
    name: "config",
    aliases: ["settings"],
    description: "Open this engine's settings",
    on: "all",
    run: () => settings("engine-clis"),
  },
  {
    name: "login",
    aliases: ["logout"],
    description: "Sign in or out of the engine",
    on: "outside",
    wins: "always",
    run: () => settings("engine-clis"),
  },
  {
    name: "theme",
    aliases: ["color", "themes"],
    description: "Change how Misty looks",
    on: "all",
    wins: "always",
    run: () => settings("appearance"),
  },
  {
    name: "keybindings",
    aliases: ["keymap", "hotkeys"],
    description: "Change Misty's keyboard shortcuts",
    on: "all",
    wins: "always",
    run: () => settings("shortcuts"),
  },
  {
    name: "vim",
    description: "Turn Vim keys in the message box on or off",
    hint: "[on|off]",
    on: "all",
    wins: "always",
    run: (args) => {
      const vim = useComposerVim.getState();
      const wanted = args.toLowerCase();
      const on = wanted === "on" ? true : wanted === "off" ? false : !vim.on;
      vim.toggle(on);
      return done(on ? "Vim keys on: Esc for normal mode, i to type" : "Vim keys off");
    },
  },
  {
    name: "voice",
    description: "Set up talking to the agent",
    on: "all",
    wins: "always",
    run: () => settings("voice"),
  },
];
