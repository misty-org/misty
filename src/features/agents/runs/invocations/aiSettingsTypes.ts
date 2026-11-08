import type { AiArtifact } from "./invocationTypes";

export type ScreenLocation = "window" | "ask";
export interface AiUserSettings {
  enabled: boolean;
  memory_enabled: boolean;
  /** Agents pause before sending, sharing, deleting and paying. Off by default. */
  app_actions_ask: boolean;
  /** Agents pause before paying while they otherwise act on their own. */
  payments_ask?: boolean;
  /** Where agents open a screen when a task needs one. "separate" is the retired agent window. */
  screen_location?: ScreenLocation | "separate";
  /** Agents may read but not act on banking, crypto, payment and adult sites. */
  agent_block_sensitive?: boolean;
  /** More sites agents may read but not act on, as hosts such as example.com. */
  agent_blocked_sites?: string[];
  /** A computer stays awake while an agent works on it. */
  keep_awake_for_agents?: boolean;
  retention_days: number;
  purge_state: "none" | "queued" | "working" | "verified" | "failed";
  disabled_at?: string;
  updated_at?: string;
}

export interface AiMemoryRecord {
  id: string;
  space_id?: string;
  kind: "fact" | "preference" | "instruction";
  content: string;
  reason?: string;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AiSurfacePreferenceRecord {
  surface_id: string;
  proactive_enabled: boolean;
  proactive_cooldown_minutes: number;
  proactive_snoozed_until?: string;
  proactive_last_shown_at?: string;
  proactive_dismissed_at?: string;
  saved_actions: AiSavedAction[];
  updated_at?: string;
}

export interface AiSavedAction {
  id: string;
  label: string;
  prompt: string;
  requested_artifact_kind?: AiArtifact["kind"];
}
