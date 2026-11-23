export type ScreenLocation = "window" | "ask";
export interface AiUserSettings {
  app_actions_ask: boolean;
  payments_ask?: boolean;
  screen_location?: ScreenLocation;
  agent_block_sensitive?: boolean;
  agent_blocked_sites?: string[];
  keep_awake_for_agents?: boolean;
  updated_at?: string;
}
