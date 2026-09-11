import { compareActivityNewestFirst } from "./activityModel";
import {
  compareAttention,
  isActivityMuted,
  isDiagnosticActivity,
  isPendingRequest,
  needsActivityAttention,
} from "./activityPolicy";
import type { ActivityItem, ActivityCategory } from "./types";

export interface ActivityData {
  accountId: string;
  deploymentScope: string;
  sourceItems: ActivityItem[];
  localItems: ActivityItem[];
  readAtByKey: Record<string, string>;
  clearedHistoryByKey: Record<string, boolean>;
  knownSourceIdsByAccount: Record<string, string[]>;
  baselinedAccounts: string[];
  historySequence: number;
  historyCheckedByAccount: Record<string, number>;
  mutedSourcesByAccount: Record<string, string[]>;
  categoriesByAccount: Record<string, Partial<Record<ActivityCategory, boolean>>>;
}

export function activityAccountKey(state: Pick<ActivityData, "accountId" | "deploymentScope">) {
  return JSON.stringify([state.deploymentScope, state.accountId]);
}
export function activityReadKey(state: ActivityData, item: ActivityItem) {
  return `${activityAccountKey(state)}:${item.id}:${item.revision ?? item.status ?? item.kind}`;
}
export function belongsToActivityAccount(item: ActivityItem, state: ActivityData): boolean {
  return (
    Boolean(state.accountId) &&
    item.accountId === state.accountId &&
    (item.deploymentScope ?? "hosted") === state.deploymentScope
  );
}
export function deriveActivityState(state: ActivityData) {
  const key = activityAccountKey(state);
  const muted = state.mutedSourcesByAccount[key] ?? [];
  const allItems = [...state.sourceItems, ...state.localItems]
    .filter(
      (item) =>
        belongsToActivityAccount(item, state) &&
        !isDiagnosticActivity(item) &&
        item.status !== "running" &&
        (isPendingRequest(item) || !state.clearedHistoryByKey?.[activityReadKey(state, item)]),
    )
    .map((item) => ({
      ...item,
      readAt: item.readAt ?? state.readAtByKey[activityReadKey(state, item)],
    }))
    .filter((item, index, items) => items.findIndex((entry) => entry.id === item.id) === index)
    .sort(compareActivityNewestFirst);
  const attentionItems = allItems
    .filter((item) => needsActivityAttention(item, muted))
    .sort(compareAttention);
  const checked = state.historyCheckedByAccount[key] ?? 0;
  const hasUnseenHistory = allItems.some(
    (item) => !isActivityMuted(item, muted) && (item.historySequence ?? 0) > checked,
  );
  return { allItems, attentionItems, attentionCount: attentionItems.length, hasUnseenHistory };
}

/** Bound each account independently; unresolved requests are never evicted. */
export function boundedActivityItems(items: ActivityItem[]): ActivityItem[] {
  const counts = new Map<string, number>();
  return [...items].sort(compareActivityNewestFirst).filter((item) => {
    const diagnostic = isDiagnosticActivity(item);
    if (!diagnostic && isPendingRequest(item)) return true;
    const key = JSON.stringify([item.deploymentScope ?? "hosted", item.accountId, diagnostic]);
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    return count < (diagnostic ? 50 : 200);
  });
}
