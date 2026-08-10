/**
 * The account's weekly hosted-AI allowance — the budget behind "This member has
 * used all of their weekly AI agent usage". It is per account, not per Space.
 */
export interface AgentUsage {
  /** 0–100. The server sends a percentage, not a ratio. */
  percentage_used: number;
  available: boolean;
  paused: boolean;
  /** When the weekly allowance renews. */
  reset_at?: string;
  plan?: string;
}
