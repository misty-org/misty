export type ScreenLocation = "window" | "ask";
export interface AiUserSettings {
  /** Agents pause before sending, sharing, deleting and paying. Off by default. */
  app_actions_ask: boolean;
  /** Agents pause before paying while they otherwise act on their own. */
  payments_ask?: boolean;
  /** Where agents open a screen when a task needs one. */
  screen_location?: ScreenLocation;
  /** Agents may read but not act on banking, crypto, payment and adult sites. */
  agent_block_sensitive?: boolean;
  /** More sites agents may read but not act on, as hosts such as example.com. */
  agent_blocked_sites?: string[];
  /** A computer stays awake while an agent works on it. */
  keep_awake_for_agents?: boolean;
  updated_at?: string;
}
