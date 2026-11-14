import { notify } from "@/shared/ui";
import { openSettings, type SettingsSection } from "@/features/settings";
import { useContextPanel, type ContextPanelTab } from "../../../context-panel/contextPanelStore";
import type { GlobalAiMessage } from "../../state/conversationTypes";

/** The shape of a command Misty runs itself, and the composer pieces such commands reach. */

/** What a command can reach in the chat it was typed in. */
export interface CommandScope {
  /** The UI's account (the composer's choices are kept under it). */
  accountId: string;
  /** The agent's engine; empty or Misty's own for Misty's runtime. */
  engine: string;
  conversationId?: string;
  /** The chat's linked folder, or empty. */
  folder: string;
  messages: GlobalAiMessage[];
  working: boolean;
  newChat?(): void;
  openHistory(): void;
  /** Stops the running turn. */
  stop(): Promise<void>;
  /** Runs `/plan`; the text to send after it, or undefined when nothing is left to send. */
  plan(typed: string): Promise<string | undefined>;
}

/** Text to send instead of what was typed, and the chat to send it in when it isn't this one. */
export interface CommandSend {
  send: string;
  conversationId?: string;
}

/** undefined: not Misty's to run, send as typed · null: done, nothing to send · else: send this. */
export type Ran = CommandSend | null;

export interface MistyCommand {
  name: string;
  aliases?: readonly string[];
  description: string;
  hint?: string;
  /** `outside`: only an outside engine's chats; `all`: Misty's own runtime too. */
  on: "outside" | "all";
  /**
   * Whether Misty's version wins over the engine's own of the same name: `always` (Misty sends
   * the choice with every turn, so an engine-side change wouldn't last), `bare` (only when typed
   * without arguments), or never, when Misty's is a fallback for engines without one.
   */
  wins?: "always" | "bare" | ((args: string, engine: string) => boolean);
  run(args: string, scope: CommandScope): Promise<Ran> | Ran;
}

export const done = (message: string) => {
  notify({ message });
  return null;
};

/** Opens one of the composer's own controls, as clicking it would. */
export function openControl(id: "model" | "mode") {
  const trigger = document.querySelector<HTMLElement>(`[data-tour="composer-${id}"]`);
  if (trigger) {
    trigger.click();
    return null;
  }
  return done(
    id === "model"
      ? "Choose the model from ⋯ in the composer"
      : "Choose the mode from ⋯ in the composer",
  );
}

export const showPanel = (tab: ContextPanelTab) => {
  useContextPanel.getState().show(tab);
  return null;
};

export const settings = (section: SettingsSection) => {
  openSettings(section);
  return null;
};
