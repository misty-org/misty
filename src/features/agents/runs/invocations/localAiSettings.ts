import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiUserSettings } from "./aiSettingsTypes";

/**
 * What agents may do on this computer: saved in misty.db, belonging to the
 * device, never sent anywhere.
 */

const scope = "device:agent-settings";

interface Stored {
  version: 1;
  settings: Partial<AiUserSettings>;
}

interface Snapshot {
  revision: number;
  state: Partial<Stored> | null;
}

const defaults: AiUserSettings = {
  app_actions_ask: false,
  payments_ask: true,
  screen_location: "window",
  agent_block_sensitive: true,
  agent_blocked_sites: [],
  keep_awake_for_agents: true,
};

const snapshot = () => invoke<Snapshot>("settings_session_state", { scope });

function settingsOf(state: Partial<Stored> | null | undefined): AiUserSettings {
  return { ...defaults, ...state?.settings };
}

async function change(update: (current: Stored) => Stored): Promise<Stored> {
  for (let attempt = 0; ; attempt++) {
    const { revision, state } = await snapshot();
    const next = update({
      version: 1,
      settings: state?.settings ?? {},
    });
    try {
      await invoke("settings_session_commit", { scope, revision, document: next });
      return next;
    } catch (error) {
      if (attempt >= 8 || !String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
}

/** This computer's settings, or the defaults outside the app. */
export async function readAgentSettings(): Promise<AiUserSettings> {
  if (!hasTauriInternals()) return { ...defaults };
  return settingsOf((await snapshot()).state);
}

export async function changeAgentSettings(
  patch: Partial<AiUserSettings>,
): Promise<{ settings: AiUserSettings }> {
  const stored = await change((current) => ({
    ...current,
    settings: { ...current.settings, ...patch, updated_at: new Date().toISOString() },
  }));
  return { settings: settingsOf(stored) };
}
