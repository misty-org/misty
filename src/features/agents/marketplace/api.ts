import type { SkillTargetId } from "@/features/engine-config/skills";
import { invoke } from "@/native/invoke";

export type MarketEngine =
  "claude" | "codex" | "omp" | "qoder" | "codebuddy" | "minimax" | "gemini" | "qwen";

const pluginEngines: ReadonlySet<string> = new Set<MarketEngine>([
  "claude",
  "codex",
  "omp",
  "qoder",
  "codebuddy",
  "minimax",
  "gemini",
  "qwen",
]);

export const hasPlugins = (engine: string): engine is MarketEngine => pluginEngines.has(engine);

const sourceEngines: ReadonlySet<MarketEngine> = new Set<MarketEngine>([
  "claude",
  "codex",
  "omp",
  "qoder",
  "codebuddy",
]);

export const takesSources = (engine: MarketEngine) => sourceEngines.has(engine);

export const pluginNoun = (engine: string) =>
  engine === "gemini" || engine === "qwen" ? "extension" : "plugin";

const skillTargets: Partial<Record<string, SkillTargetId>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  kimi: "kimi",
  grok: "grok",
  qoder: "qoder",
  "qoder-cn": "qoder-cn",
  omp: "omp",
  agy: "agy",
  pi: "pi",
  dsh: "dsh",
  qwen: "qwen",
  codebuddy: "codebuddy",
};

export const skillTargetOf = (engine: string) => skillTargets[engine];

interface SuggestedMarketplace {
  source: string;
  name: string;
  line: string;
}

const officialClaude: SuggestedMarketplace = {
  source: "anthropics/claude-plugins-official",
  name: "Claude plugins",
  line: "Anthropic's official plugin directory",
};
const anthropicSkills: SuggestedMarketplace = {
  source: "anthropics/skills",
  name: "Anthropic skills",
  line: "Anthropic's own skills: documents, spreadsheets, slides and examples",
};
const workflows: SuggestedMarketplace = {
  source: "wshobson/agents",
  name: "Claude Code workflows",
  line: "Plugins for languages, testing, security and infrastructure",
};
const superpowers: SuggestedMarketplace = {
  source: "obra/superpowers-marketplace",
  name: "Superpowers",
  line: "Skills for planning, testing and debugging",
};
const hashicorp: SuggestedMarketplace = {
  source: "hashicorp/agent-skills",
  name: "HashiCorp",
  line: "Terraform and Packer, from HashiCorp",
};

const suggestedMarketplaces: Record<MarketEngine, SuggestedMarketplace[]> = {
  claude: [anthropicSkills, workflows, superpowers, hashicorp],
  codex: [workflows, hashicorp],
  omp: [officialClaude, anthropicSkills, workflows, superpowers, hashicorp],
  codebuddy: [officialClaude, anthropicSkills, workflows, superpowers, hashicorp],
  qoder: [],
  minimax: [],
  gemini: [],
  qwen: [],
};

export function unaddedSuggestions(engine: MarketEngine, sources: MarketSource[]) {
  const known = sources.map((entry) => entry.location.toLowerCase());
  return suggestedMarketplaces[engine].filter(
    (suggestion) => !known.some((location) => location.includes(suggestion.source.toLowerCase())),
  );
}

export interface MarketItem {
  id: string;
  name: string;
  description: string;
  engine: MarketEngine;
  marketplace: string;
  category: string | null;
  installed: boolean;
  enabled: boolean;
  installs: number | null;
  link: string | null;
  signIn: "on_install" | "on_use" | null;
  stars: number | null;
  author?: string | null;
}

export interface MarketSource {
  name: string;
  location: string;
}

export interface EngineMarket {
  engine: MarketEngine;
  ready: boolean;
  items: MarketItem[];
  sources: MarketSource[];
  error: string | null;
}

type InstallOutcome =
  | { result: "installed" }
  | { result: "confirmCommand"; command: { command: string; sha256: string } };

export interface EngineConnector {
  engine: MarketEngine;
  name: string;
  origin: "account" | "plugin" | "config";
  state: "connected" | "needs_sign_in" | "failed" | "pending" | "off";
}

export interface PluginContents {
  known: boolean;
  version: string | null;
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  mcpServers: string[];
}

export const canTurnOff = (engine: string) => engine === "claude";

export const marketApi = {
  list: (engine: MarketEngine) => invoke<EngineMarket>("engine_market_list", { engine }),
  install: (engine: MarketEngine, id: string, accept?: string) =>
    invoke<InstallOutcome>("engine_market_install", { engine, id, accept: accept ?? null }),
  remove: (engine: MarketEngine, id: string) =>
    invoke<void>("engine_market_remove", { engine, id }),
  addSource: (engine: MarketEngine, source: string) =>
    invoke<void>("engine_market_add_source", { engine, source }),
  removeSource: (engine: MarketEngine, name: string) =>
    invoke<void>("engine_market_remove_source", { engine, name }),
  connectors: () => invoke<EngineConnector[]>("engine_market_connectors"),
  details: (engine: MarketEngine, id: string) =>
    invoke<PluginContents>("engine_market_details", { engine, id }),
  setEnabled: (engine: MarketEngine, id: string, enabled: boolean) =>
    invoke<void>("engine_market_set_enabled", { engine, id, enabled }),
};

export const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message
    ? reason.message
    : typeof reason === "string" && reason
      ? reason
      : fallback;

export function matchItems(items: MarketItem[], query: string, installedOnly: boolean) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (installedOnly && !item.installed) return false;
    if (!words.length) return true;
    const haystack =
      `${item.name} ${item.id} ${item.description} ${item.category ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function orderItems(items: MarketItem[]) {
  return [...items].sort(
    (a, b) =>
      Number(b.installed) - Number(a.installed) ||
      (b.installs ?? -1) - (a.installs ?? -1) ||
      (b.stars ?? -1) - (a.stars ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

export const categoryLabel = (category: string | null) =>
  category ? category.charAt(0).toUpperCase() + category.slice(1).replace(/[-_]/g, " ") : "";

export type MarketSort = "popular" | "name";

export function categoriesOf(items: MarketItem[]) {
  const counts = new Map<string, number>();
  for (const item of items)
    if (item.category) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
