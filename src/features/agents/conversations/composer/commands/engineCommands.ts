import { invoke } from "@/native/invoke";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import type { SettingsSection } from "@/features/settings";
import { engineCatalog, mistyEngine, type EngineCatalog } from "../../../engines/enginesApi";
import { agentAccountId } from "../../../personal/agentAccount";
import type { ContextPanelTab } from "../../../context-panel/contextPanelStore";
import { forkChat } from "../../state/chatOrganizing";
import { useMistyStore } from "../../state/useMistyStore";
import { useCommandReport, type CommandOutput } from "./commandOutput";
import {
  done,
  mistyCommands,
  openControl,
  settings,
  showPanel,
  type CommandScope,
  type CommandSend,
  type MistyCommand,
  type Ran,
} from "./mistyCommands";

export type { CommandScope, CommandSend } from "./mistyCommands";

/**
 * The `/` commands of a chat's engine, all of them: what the engine runs itself, what its adapter
 * runs for it (`src-tauri/features/engines/slash`), and Misty's own versions of what an engine
 * only does in its terminal app (`mistyCommands.ts`). Misty is a window onto each engine, so
 * nothing its terminal app can do is missing here.
 */

/** The commands Misty asks before running, since they delete or send something away. */
function confirmation(name: string, args: string, engine: string): string | undefined {
  const first = args.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (name === "delete") return "Delete this chat's engine session for good? This can't be undone.";
  if (name === "share") return "Share this session publicly? Anyone with the link can read it.";
  if (name === "feedback" || name === "bug")
    return "Send this feedback, with the session's details, to the engine's makers?";
  if (name === "usage" && first === "reset") return "Use one of your limit reset credits now?";
  if (name === "import" && first === "yes") return "Import the setup and chats found?";
  if (name === "undo") return "Undo the last message and its file changes?";
  if (name === "ultrareview") return "Start a paid cloud review of this branch?";
  if (name === "design-consent" || name === "design-revoke")
    return "Change what your account allows for design tools?";
  if (name === "mcp" && /^(enable|disable)$/.test(first) && /\ball$/i.test(args))
    return `${first === "enable" ? "Turn on" : "Turn off"} every MCP server?`;
  if (name === "commit") return "Let the engine commit the current changes?";
  if (name === "topup") return "Open a top-up for the engine's account?";
  if (name === "debug" && first === "upload")
    return "Upload the engine's debug logs and share links to them?";
  if (name === "rename" && engine === "grok")
    return "Rename this session? Grok may sync the title to xAI.";
  if (name === "archive") return "Archive this chat's engine session?";
  if (name === "memories" && first === "reset") return "Forget everything the engine remembered?";
  if (name === "move") return "Move the engine's session out of this chat's folder?";
  if (name === "restore" && first === "enable")
    return "Turn on checkpointing in your Gemini CLI settings?";
  const removes = /^(delete|remove|rm|drop|clear|reset|uninstall|unauth)$/.test(first);
  if (
    removes &&
    ["session", "memory", "mcp", "marketplace", "ssh", "todo", "plugins", "chat"].includes(name)
  )
    return `Run /${name} ${first}? What it removes can't be brought back.`;
  if (name === "org" && first) return `Switch the engine's organization to ${first}?`;
  return undefined;
}

const catalogs = new Map<string, Promise<EngineCatalog>>();

/** An engine's catalog for a folder, read again a minute after it was last read. */
export function catalogFor(engine: string, folder: string) {
  const key = `${engine}\n${folder}`;
  let pending = catalogs.get(key);
  if (!pending) {
    pending = engineCatalog(engine, folder).catch(() => ({ commands: [], skills: [] }));
    catalogs.set(key, pending);
    // Commands and skills change rarely; a minute later the next menu reads them again.
    setTimeout(() => catalogs.delete(key), 60_000);
  }
  return pending;
}

const isOutside = (engine: string) => Boolean(engine && engine !== mistyEngine);

const named = (command: MistyCommand, name: string) =>
  command.name === name || Boolean(command.aliases?.includes(name));

/** A row of the `/` menu that Misty itself runs. */
export interface MistyCommandRow {
  name: string;
  description: string;
  hint?: string;
}

/**
 * Misty's commands for a chat on `engine`, for the `/` menu. One the engine has itself is left
 * to the engine's row, unless Misty's always wins.
 */
export function mistyCommandsFor(engine: string, engineNames: Set<string>): MistyCommandRow[] {
  const outside = isOutside(engine);
  return (
    mistyCommands
      .filter((command) => command.on === "all" || outside)
      // One that wins when typed bare or as a fallback leaves its row to the engine's own.
      .filter((command) => {
        const wins =
          command.wins === "always" ||
          (typeof command.wins === "function" && command.wins("", engine));
        return wins || !engineNames.has(command.name);
      })
      .map(({ name, description, hint }) => ({ name, description, hint }))
  );
}

/** Acts on what an engine command run by Misty gave back. */
async function follow(output: CommandOutput, scope: CommandScope): Promise<Ran> {
  switch (output.kind) {
    case "info":
      useCommandReport.getState().show({ title: output.title, sections: output.sections });
      return null;
    case "send":
      return { send: output.text };
    case "done":
      return output.notice ? done(output.notice) : null;
    case "rename":
      if (scope.conversationId)
        await useMistyStore.getState().renameConversation(scope.conversationId, output.title);
      return null;
    case "fork": {
      if (!scope.conversationId) return null;
      const copy = forkChat(scope.conversationId);
      if (!copy) return null;
      if (output.title) await useMistyStore.getState().renameConversation(copy, output.title);
      // The copy continues the engine's new session, not a replay of the turns.
      await invoke("engine_chat_resume", {
        account: agentAccountId(),
        conversation: copy,
        engine: scope.engine,
        folder: scope.folder,
        sessionId: output.session,
      });
      useMistyStore.getState().selectConversation(copy);
      return output.prompt ? { send: output.prompt, conversationId: copy } : null;
    }
    case "open":
      return open(output.target, scope);
  }
}

function open(target: string, scope: CommandScope): Ran {
  const [kind, ...rest] = target.split(":");
  const value = rest.join(":");
  if (kind === "settings") return settings(value as SettingsSection);
  if (kind === "panel") return showPanel(value as ContextPanelTab);
  if (kind === "history") {
    scope.openHistory();
    return null;
  }
  if (kind === "picker") return openControl(value === "mode" ? "mode" : "model");
  if (kind === "url") {
    void openExternalLink(value);
    return null;
  }
  return null;
}

/**
 * Runs `typed` when it is a command Misty runs: one of its own, or one of the engine's that the
 * engine can't run headless. Resolves to undefined when it isn't, so it goes to the engine as
 * typed; null when it was run and nothing is left to send; or the text to send instead.
 */
export async function runComposerCommand(
  typed: string,
  scope: CommandScope,
): Promise<CommandSend | null | undefined> {
  const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(typed.trim());
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();
  const outside = isOutside(scope.engine);
  const own = mistyCommands.find(
    (command) => named(command, name) && (command.on === "all" || outside),
  );
  const wins =
    own?.wins === "always" ||
    (own?.wins === "bare" && !args) ||
    (typeof own?.wins === "function" && own.wins(args, scope.engine));
  if (own && wins) return own.run(args, scope);
  if (outside) {
    const catalog = await catalogFor(scope.engine, scope.folder);
    const item = catalog.commands.find((command) => command.name.toLowerCase() === name);
    if (item?.runs === "misty") {
      const ask = confirmation(name, args, scope.engine);
      if (ask && !(await confirmAction(ask))) return null;
      const output = await invoke<CommandOutput>("engine_command_run", {
        account: agentAccountId(),
        conversation: scope.conversationId ?? "",
        engine: scope.engine,
        folder: scope.folder,
        name,
        args,
      });
      return follow(output, scope);
    }
    // The engine runs it in the turn, once the person agrees to one that removes or sends away.
    if (item) {
      const ask = confirmation(name, args, scope.engine);
      if (ask && !(await confirmAction(ask))) return null;
      return undefined;
    }
  }
  return own ? own.run(args, scope) : undefined;
}
