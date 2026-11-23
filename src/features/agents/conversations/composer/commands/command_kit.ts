import { notify } from "@misty/ui";
import { openSettings, type SettingsSection } from "@/features/settings";
import { openAgentsHub, type AgentsHubPage } from "../../../hub/agents_hub_store";
import { useContextPanel, type ContextPanelTab } from "../../../context-panel/context_panel_store";
import type { GlobalAiMessage } from "../../state/conversation_types";

export interface CommandScope {
  accountId: string;
  engine: string;
  conversationId?: string;
  folder: string;
  messages: GlobalAiMessage[];
  working: boolean;
  newChat?(): void;
  openHistory(): void;
  stop(): Promise<void>;
  plan(typed: string): Promise<string | undefined>;
}

export interface CommandSend {
  send: string;
  conversationId?: string;
  after?(): Promise<void>;
}

export type Ran = CommandSend | null;

export interface MistyCommand {
  name: string;
  aliases?: readonly string[];
  description: string;
  hint?: string;
  on: "outside" | "all";
  wins?: "always" | "bare" | ((args: string, engine: string) => boolean);
  run(args: string, scope: CommandScope): Promise<Ran> | Ran;
}

export const done = (message: string) => {
  notify({ message });
  return null;
};

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

export const hub = (page: AgentsHubPage) => {
  openAgentsHub(page);
  return null;
};
