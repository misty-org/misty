import { shortcutCommandRegistry } from "@/features/shortcuts";
import { dockTabs, useWorkspaceStore } from "@/features/workspace";
import type { GlobalSearchFilters, GlobalSearchResult, UnifiedMistyCandidate } from "./types";

const coreToolCommandIds = new Set([
  "tool.home",
  "tool.journal",
  "tool.planner",
  "tool.social",
  "tool.inbox",
  "tool.library",
  "tool.browser",
  "tool.files",
  "tool.code",
]);

export function buildUnifiedMistyCandidates(
  query: string,
  results: GlobalSearchResult[],
  filters: GlobalSearchFilters,
): UnifiedMistyCandidate[] {
  const normalized = normalize(query);
  if (!normalized) return emptyCandidates();
  const intent = mistyIntent(normalized);
  const navigation = /^(open|go to|take me to|show me)\b/.test(normalized);
  const objectQuery = normalized.replace(/^(open|go to|take me to|show me)\s+/, "");
  const candidates: UnifiedMistyCandidate[] = [];

  for (const result of results) {
    if (!matchesFilters(result, filters)) continue;
    const title = normalize(result.title);
    const exact = title === objectQuery;
    const prefix = !exact && title.startsWith(objectQuery);
    const score = (exact ? 150 : prefix ? 112 : 55) + Math.min(35, result.score || 0);
    candidates.push({
      id: `object:${result.canonicalId ?? `${result.kind}:${result.id}`}`,
      type: navigation && (exact || prefix) ? "navigation" : "object",
      title: result.title,
      description: result.body || result.spaceName || result.kind,
      score: navigation ? score + 15 : score,
      ranking: [exact ? "exact" : prefix ? "prefix" : "retrieval", result.source],
      result,
    });
  }

  if (filters.intent !== "agent") {
    candidates.push({
      id: `answer:${normalized}`,
      type: "answer",
      title: `Ask Misty “${query.trim()}”`,
      description: "Get a grounded answer with sources from Misty",
      prompt: query.trim(),
      score: filters.intent === "misty" ? 180 : intent === "answer" ? 128 : 48,
      ranking: [intent === "answer" ? "conversational-intent" : "available-answer"],
    });
  }
  if (filters.intent !== "misty") {
    candidates.push({
      id: `agent:${normalized}`,
      type: "agent_task",
      title: `Have Misty handle “${query.trim()}”`,
      description: "Route this work to the best available Space Agent",
      prompt: query.trim(),
      score: filters.intent === "agent" ? 180 : intent === "agent" ? 132 : 28,
      ranking: [intent === "agent" ? "work-intent" : "available-agent"],
    });
  }

  for (const command of shortcutCommandRegistry) {
    const haystack = normalize(
      [command.label, command.description, command.category, ...command.aliases].join(" "),
    );
    if (!haystack.includes(normalized)) continue;
    const title = normalize(command.label);
    candidates.push({
      id: `command:${command.id}`,
      type: "command",
      title: command.label,
      description: command.description,
      commandId: command.id,
      score: title === normalized ? 155 : title.startsWith(normalized) ? 110 : 62,
      ranking: [title === normalized ? "exact-command" : "command"],
    });
  }

  return candidates.sort(
    (left, right) => right.score - left.score || left.title.localeCompare(right.title),
  );
}

function emptyCandidates(): UnifiedMistyCandidate[] {
  const state = useWorkspaceStore.getState();
  const recent = (state.virtualWindowsByScope[state.activeScopeKey] ?? [])
    .flatMap((window) => dockTabs(window.layout.root))
    .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)
    .slice(0, 4)
    .map<UnifiedMistyCandidate>((tab, index) => ({
      id: `recent:${tab.id}`,
      type: "command",
      title: tab.title,
      description: "Recent tab",
      tabId: tab.id,
      score: 100 - index,
      ranking: ["recent"],
    }));
  const tools = shortcutCommandRegistry
    .filter((command) => coreToolCommandIds.has(command.id))
    .slice(0, 8)
    .map<UnifiedMistyCandidate>((command, index) => ({
      id: `command:${command.id}`,
      type: "command",
      title: command.label,
      description: command.description,
      commandId: command.id,
      score: 70 - index,
      ranking: ["core-command"],
    }));
  return [...recent, ...tools];
}

function matchesFilters(result: GlobalSearchResult, filters: GlobalSearchFilters) {
  if (filters.kinds.length && !filters.kinds.includes(result.kind)) return false;
  if (filters.spaceId && result.spaceId !== filters.spaceId) return false;
  if (filters.source === "device" && result.source !== "device") return false;
  if (filters.source === "cloud" && result.source === "device") return false;
  return true;
}

export function mistyIntent(query: string): "answer" | "agent" | "search" {
  const agentVerb =
    "create|write|draft|draw|sketch|illustrate|organize|plan|research|build|make|" +
    "send|schedule|delegate|handle|update|change|fix|prepare|collect|turn";
  const agentRequest = new RegExp(
    `^(?:(?:please|can you|could you|would you|will you|i need you to)\\s+)?(?:${agentVerb})\\b`,
  );
  if (agentRequest.test(query)) {
    return "agent";
  }
  if (
    /^(why|what|when|where|who|which|how|can you explain|tell me|compare|summari[sz]e|explain)\b/.test(
      query,
    ) ||
    query.endsWith("?")
  ) {
    return "answer";
  }
  return "search";
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .trim();
}
