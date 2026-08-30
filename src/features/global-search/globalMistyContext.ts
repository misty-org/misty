import type { GlobalAiContextRef } from "./types";

export function uniqueGlobalMistyContext(context: GlobalAiContextRef[]): GlobalAiContextRef[] {
  const seen = new Set<string>();
  return context.filter((item) => {
    const key = globalMistyContextIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function globalMistyContextIdentity(item: GlobalAiContextRef): string {
  if (item.kind === "route") {
    if (item.spaceId) return `route:space:${item.spaceId}`;
    return `route:${item.href?.split(/[?#]/)[0] ?? item.title}`;
  }
  if (item.localPath) return `${item.kind}:path:${item.localPath}`;
  if (item.href) return `${item.kind}:href:${item.href}`;
  return `${item.kind}:${item.spaceId ?? "account"}:${item.id}`;
}

export function mergeGlobalMistyContext(
  current: GlobalAiContextRef[],
  incoming: GlobalAiContextRef[],
) {
  return uniqueGlobalMistyContext([...incoming, ...current]).slice(0, 12);
}
