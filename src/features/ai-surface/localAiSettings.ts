import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiUserSettings } from "./aiSettingsTypes";
import type { AiInvocationRequest } from "./types";

/**
 * What agents may do on this computer: saved in misty.db, belonging to the
 * device, never sent anywhere. The one thing that isn't a setting here is which Get started steps have
 * been done, kept beside them because it's this computer's too.
 */

const scope = "device:agent-settings";

export type OnboardingStep = "page_ask" | "workflow_run";

interface Stored {
  version: 1;
  settings: Partial<AiUserSettings>;
  steps: OnboardingStep[];
}

interface Snapshot {
  revision: number;
  state: Partial<Stored> | null;
}

const defaults: AiUserSettings = {
  enabled: true,
  memory_enabled: true,
  app_actions_ask: false,
  payments_ask: true,
  screen_location: "window",
  agent_block_sensitive: true,
  agent_blocked_sites: [],
  keep_awake_for_agents: true,
  retention_days: 30,
  purge_state: "none",
};

const snapshot = () => invoke<Snapshot>("settings_session_state", { scope });

export function settingsOf(state: Partial<Stored> | null | undefined): AiUserSettings {
  return { ...defaults, ...state?.settings };
}

async function change(update: (current: Stored) => Stored): Promise<Stored> {
  for (let attempt = 0; ; attempt++) {
    const { revision, state } = await snapshot();
    const next = update({
      version: 1,
      settings: state?.settings ?? {},
      steps: state?.steps ?? [],
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

export async function onboardingSteps(): Promise<OnboardingStep[]> {
  if (!hasTauriInternals()) return [];
  return (await snapshot()).state?.steps ?? [];
}

/** Get started ticks off what's actually been done here. Never gets in a run's way. */
export async function noteOnboardingStep(run: AiInvocationRequest): Promise<void> {
  const step: OnboardingStep | null = run.methodVersionId
    ? "workflow_run"
    : run.currentTab || run.context.some((reference) => reference.kind === "browser-tab")
      ? "page_ask"
      : null;
  if (!step) return;
  await change((current) =>
    current.steps.includes(step) ? current : { ...current, steps: [...current.steps, step] },
  ).catch(() => undefined);
}
