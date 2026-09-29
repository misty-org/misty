import { cachedRequest } from "@/api/cache/cachedRequest";
import { invoke } from "@tauri-apps/api/core";

/** A coding tool Misty can hand work to, and what it can do. */
export interface CodingTool {
  id: string;
  name: string;
  /** Asks before acting mid-turn, so Ask and Auto both work fully. */
  asks: boolean;
  /** Can only run with full access; Auto only, with every project grant remembered. */
  fullAccessOnly?: boolean;
  /** Reports how much of its own usage limit it used. */
  reportsUsage: boolean;
  /** Its maker's artwork in the shared brand icons, when there is some. */
  brand?: string;
}

export const codingTools: CodingTool[] = [
  { id: "claude", name: "Claude Code", brand: "anthropic", asks: true, reportsUsage: false },
  { id: "codex", name: "Codex", brand: "openai", asks: true, reportsUsage: true },
  { id: "minimax", name: "MiniMax Code", brand: "minimax", asks: true, reportsUsage: false },
  { id: "kimi", name: "Kimi Code", brand: "moonshot", asks: true, reportsUsage: false },
  { id: "omp", name: "Oh My Pi", asks: true, reportsUsage: false },
  { id: "opencode", name: "OpenCode", asks: true, reportsUsage: false },
  { id: "pi", name: "Pi", asks: false, reportsUsage: false },
  { id: "agy", name: "Antigravity", asks: false, reportsUsage: false },
  { id: "qoder", name: "Qoder", asks: false, reportsUsage: false },
  { id: "qoder-cn", name: "Qoder (China)", asks: false, reportsUsage: false },
  {
    id: "grok",
    name: "Grok",
    brand: "xai",
    asks: false,
    fullAccessOnly: true,
    reportsUsage: false,
  },
  {
    id: "dsh",
    name: "DeepSeek Shell",
    brand: "deepseek",
    asks: false,
    fullAccessOnly: true,
    reportsUsage: false,
  },
];

export const codingToolName = (id: string) =>
  codingTools.find((tool) => tool.id === id)?.name ?? id;

/** What this device found for one tool. */
export interface CodingToolStatus {
  engine: string;
  installed: boolean;
  signed_in: boolean;
  version: string;
}

export const detectCodingTools = () => invoke<CodingToolStatus[]>("coding_engines_detect");

/** The account's coding allowance, from the server. Basic plans have none. */
export interface CodingAllowance {
  available: boolean;
  plan: string;
  allowanceTokens: number;
  usedTokens: number;
  resetsAt?: string;
}

export const codingAllowance = () => cachedRequest<CodingAllowance>("/me/coding/allowance");

/** One line on what a tool can do and whether it's ready. */
export function codingToolStatusText(tool: CodingTool, status?: CodingToolStatus) {
  if (!status?.installed) return "Not installed on this computer.";
  const ready = status.signed_in
    ? `Signed in${status.version ? ` · ${status.version}` : ""}.`
    : "Signed out. Sign in to it in a terminal.";
  const asks = tool.fullAccessOnly
    ? ` ${tool.name} can’t ask before acting, so it runs only in Auto.`
    : tool.asks
      ? ""
      : " Can’t ask before acting, so in Ask it only plans.";
  const usage = tool.reportsUsage ? "" : " Usage cap unavailable for this tool.";
  return `${ready}${asks}${usage}`;
}
