import { useEffect } from "react";
import { createDeviceSettingMap } from "@/shared/lib/device_setting_map";

const keep = 500;
const none: readonly string[] = [];
const scopeKey = (accountId: string, spaceId: string) => `${accountId}.${spaceId}`;
const legacyKey = (scope: string) => `misty.handoffs.handled.${scope}`;

const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : undefined;

const handled = createDeviceSettingMap<string[]>({
  scope: "spaces.handoffs.handled",
  limit: 100,
  normalize: (stored) => ids(stored)?.slice(-keep),
});

function moveLegacy(scope: string) {
  let saved: string[] | undefined;
  try {
    const raw = localStorage.getItem(legacyKey(scope));
    if (raw === null) return;
    saved = ids(JSON.parse(raw));
    localStorage.removeItem(legacyKey(scope));
  } catch {
    return;
  }
  const moved = saved ?? [];
  if (moved.length)
    handled.set(scope, (current) => [...new Set([...(current ?? []), ...moved])].slice(-keep));
}

export function markHandoffHandled(accountId: string, spaceId: string, messageId: string) {
  if (!accountId) return;
  const scope = scopeKey(accountId, spaceId);
  moveLegacy(scope);
  if (handled.get(scope)?.includes(messageId)) return;
  handled.set(scope, (current = []) =>
    current.includes(messageId) ? current : [...current, messageId].slice(-keep),
  );
}

export function useHandledHandoffs(accountId: string, spaceId: string): readonly string[] {
  const scope = accountId ? scopeKey(accountId, spaceId) : undefined;
  useEffect(() => {
    if (scope) moveLegacy(scope);
  }, [scope]);
  return handled.useEntry(scope) ?? none;
}
