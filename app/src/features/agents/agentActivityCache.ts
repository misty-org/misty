import { agentsApi } from "@/api/agents/api";
import type {
  PersonalAgentActivityPage,
  PersonalAgentRunDetail,
} from "./model/interfaces/personal";
import { registerAgentCacheReset } from "./agentCacheLifecycle";

interface ActivityEntry {
  value?: PersonalAgentActivityPage;
  fetchedAt?: number;
  promise?: Promise<PersonalAgentActivityPage>;
  requestVersion?: number;
}

interface DetailEntry {
  value?: PersonalAgentRunDetail;
  fetchedAt?: number;
  promise?: Promise<PersonalAgentRunDetail>;
  requestVersion?: number;
}

const activities = new Map<string, ActivityEntry>();
const details = new Map<string, DetailEntry>();
const activityFreshnessMs = 2_000;
const detailFreshnessMs = 30_000;

export function cachedAgentActivity(agentId: string) {
  return activities.get(agentId)?.value;
}

export function cachedAgentRunDetail(runId: string) {
  return details.get(runId)?.value;
}

export function setCachedAgentActivity(value: PersonalAgentActivityPage): void {
  const entry = activities.get(value.agent_id) ?? {};
  activities.set(value.agent_id, { ...entry, value, fetchedAt: Date.now() });
}

export function loadAgentActivity(agentId: string, force = false) {
  return cachedRequest(activities, agentId, activityFreshnessMs, force, () =>
    agentsApi.activity<PersonalAgentActivityPage>(agentId),
  );
}

export function loadAgentRunDetail(runId: string, force = false) {
  return cachedRequest(details, runId, detailFreshnessMs, force, () =>
    agentsApi.run<PersonalAgentRunDetail>(runId),
  );
}

function cachedRequest<T>(
  cache: Map<
    string,
    { value?: T; fetchedAt?: number; promise?: Promise<T>; requestVersion?: number }
  >,
  key: string,
  freshnessMs: number,
  force: boolean,
  fetcher: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(key) ?? {};
  if (entry.promise && !force) return entry.promise;
  if (!force && entry.value && Date.now() - (entry.fetchedAt ?? 0) < freshnessMs) {
    return Promise.resolve(entry.value);
  }
  const requestVersion = (entry.requestVersion ?? 0) + 1;
  const request = fetcher().then((value) => {
    const current = cache.get(key);
    if ((current?.requestVersion ?? 0) > requestVersion) return current?.value ?? value;
    cache.set(key, { value, fetchedAt: Date.now(), requestVersion });
    return value;
  });
  cache.set(key, { ...entry, promise: request, requestVersion });
  return request.finally(() => {
    const current = cache.get(key);
    if (current?.promise === request) delete current.promise;
  });
}

export function clearAgentActivityCache(): void {
  activities.clear();
  details.clear();
}

registerAgentCacheReset(clearAgentActivityCache);
