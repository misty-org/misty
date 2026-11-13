import type { SkillTargetId } from "@/features/engine-config/skills";
import { invoke } from "@/native/invoke";

/**
 * Engines whose own CLI lists and installs plugins or extensions. Gemini CLI and Qwen Code
 * install from Gemini's public extension gallery.
 */
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

/** Engines that take marketplaces from Misty (`plugin marketplace add`). */
const sourceEngines: ReadonlySet<MarketEngine> = new Set<MarketEngine>([
  "claude",
  "codex",
  "omp",
  "qoder",
  "codebuddy",
]);

export const takesSources = (engine: MarketEngine) => sourceEngines.has(engine);

/** What an engine calls its add-ons, for the page's words. */
export const pluginNoun = (engine: string) =>
  engine === "gemini" || engine === "qwen" ? "extension" : "plugin";

/** Each engine's folder in the skills hub, which keeps one copy of a skill and syncs it there. */
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

/** What the page offers for an engine, in the order its switch shows them. */
export type MarketKind = "plugins" | "skills";

export function kindsFor(engine: string): MarketKind[] {
  return [
    ...(hasPlugins(engine) ? (["plugins"] as const) : []),
    ...(skillTargetOf(engine) ? (["skills"] as const) : []),
  ];
}

interface SuggestedMarketplace {
  /** What the engine's `plugin marketplace add` takes. */
  source: string;
  name: string;
  line: string;
}

/**
 * Marketplaces from makers and well-known open-source repositories, offered with one click. Each
 * was checked to be a real marketplace for that engine (checked 2026-11-12); anything else a
 * person adds by hand.
 */
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
  // Oh My Pi reads Claude Code's marketplace format, and starts with none of its own.
  omp: [officialClaude, anthropicSkills, workflows, superpowers, hashicorp],
  // CodeBuddy reads Claude Code's plugin format too.
  codebuddy: [officialClaude, anthropicSkills, workflows, superpowers, hashicorp],
  qoder: [],
  minimax: [],
  gemini: [],
  qwen: [],
};

/** Suggestions the engine doesn't read from yet, matched by the repository in its sources. */
export function unaddedSuggestions(engine: MarketEngine, sources: MarketSource[]) {
  const known = sources.map((entry) => entry.location.toLowerCase());
  return suggestedMarketplaces[engine].filter(
    (suggestion) => !known.some((location) => location.includes(suggestion.source.toLowerCase())),
  );
}

/** One plugin an engine's marketplaces offer or already have installed. */
export interface MarketItem {
  /** `plugin@marketplace`, what the engine's own install command takes. */
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
  /** When the plugin signs in to an app of its own (Codex). */
  signIn: "on_install" | "on_use" | null;
  /** The GitHub stars Gemini's extension gallery reports. */
  stars: number | null;
}

export interface MarketSource {
  name: string;
  location: string;
}

export interface EngineMarket {
  engine: MarketEngine;
  /** The engine's CLI answered; when it didn't, `error` has its words. */
  ready: boolean;
  items: MarketItem[];
  sources: MarketSource[];
  error: string | null;
}

type InstallOutcome =
  | { result: "installed" }
  | { result: "confirmCommand"; command: { command: string; sha256: string } };

/** An app an engine reaches under the person's own sign-in. */
export interface EngineConnector {
  engine: MarketEngine;
  name: string;
  origin: "account" | "plugin" | "config";
  state: "connected" | "needs_sign_in" | "failed" | "pending" | "off";
}

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
};

export const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message
    ? reason.message
    : typeof reason === "string" && reason
      ? reason
      : fallback;

/** Plugins that match every word of the search, by name, description, marketplace or category. */
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

/** Installed first, then the most installed, then by name. */
export function orderItems(items: MarketItem[]) {
  return [...items].sort(
    (a, b) =>
      Number(b.installed) - Number(a.installed) ||
      (b.installs ?? -1) - (a.installs ?? -1) ||
      (b.stars ?? -1) - (a.stars ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

const installsFormat = new Intl.NumberFormat(undefined, { notation: "compact" });

/** The muted line under a plugin: what it does, where it's from, how used it is. */
export function itemDetails(item: MarketItem) {
  return [
    item.description,
    item.marketplace,
    item.installs ? `${installsFormat.format(item.installs)} installs` : "",
    item.stars ? `${installsFormat.format(item.stars)} stars` : "",
    item.signIn === "on_install" ? "Signs in when installed" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
