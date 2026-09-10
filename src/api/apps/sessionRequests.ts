import { readApiSessionGeneration } from "@/api/client/session";
import { ApiRequestError } from "@/api/client/errors";
import type { OfficialAppSession } from "./api";

/** One token request per authenticated scope and authority generation, shared by native helpers and views. */
export function createAppSessionRequests(generation: () => number) {
  let epoch = generation();
  const revisions = new Map<string, number>();
  const pending = new Map<string, Promise<OfficialAppSession>>();
  const saved = new Map<string, OfficialAppSession>();
  const failures = new Map<string, { until: number; error: unknown }>();
  let limited: { until: number; error: unknown } | undefined;
  const get = async (
    appId: string,
    spaceId: string,
    authority: number | undefined,
    request: () => Promise<OfficialAppSession>,
  ): Promise<OfficialAppSession> => {
    const current = generation();
    if (current !== epoch) {
      epoch = current;
      revisions.clear();
      pending.clear();
      saved.clear();
      failures.clear();
      limited = undefined;
    }
    const scope = JSON.stringify([appId, spaceId]);
    const revision = revisions.get(scope) ?? 0;
    const key = JSON.stringify([appId, spaceId, authority, revision]);
    const cached = saved.get(key);
    if (cached && Date.parse(cached.expires_at) - Date.now() > 45_000) return cached;
    saved.delete(key);
    if (limited && limited.until > Date.now()) throw limited.error;
    const failure = failures.get(key);
    if (failure && failure.until > Date.now()) throw failure.error;
    failures.delete(key);
    const active = pending.get(key);
    if (active) return active;
    const operation = Promise.resolve()
      .then(() => {
        if (generation() !== current || (revisions.get(scope) ?? 0) !== revision)
          throw new Error("The account or app access changed. Try again.");
        return request();
      })
      .then((session) => {
        if (generation() !== current || (revisions.get(scope) ?? 0) !== revision)
          throw new Error("The account or app access changed. Try again.");
        // Never cache an unbound token or one issued across an authority change.
        if (
          authority !== undefined &&
          session.authority_generation === authority &&
          session.app_id === appId &&
          session.space_id === spaceId &&
          Date.parse(session.expires_at) - Date.now() > 45_000
        ) {
          if (saved.size >= 128) saved.delete(saved.keys().next().value!);
          saved.set(key, session);
        }
        return session;
      })
      .catch((error) => {
        if (generation() === current) {
          if (error instanceof ApiRequestError && error.status === 429) {
            limited = { until: Date.now() + Math.max(1000, error.retryAfterMs ?? 60_000), error };
          } else {
            if (failures.size >= 128) failures.delete(failures.keys().next().value!);
            failures.set(key, { until: Date.now() + 5000, error });
          }
        }
        throw error;
      })
      .finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      });
    pending.set(key, operation);
    return operation;
  };
  return Object.assign(get, {
    invalidate(appId: string, spaceId: string) {
      const scope = JSON.stringify([appId, spaceId]);
      revisions.set(scope, (revisions.get(scope) ?? 0) + 1);
      for (const key of saved.keys()) {
        const [app, space] = JSON.parse(key);
        if (app === appId && space === spaceId) saved.delete(key);
      }
    },
  });
}

export const appSessionRequests = createAppSessionRequests(readApiSessionGeneration);
