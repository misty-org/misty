import { createDeviceSetting } from "@/shared/lib/device_setting";
import type { DirectConversation } from "./api";

export interface DmLocal {
  names: Record<string, string>;
  closed: Record<string, string>;
  closedAgents: Record<string, string>;
}

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
        ),
      )
    : {};

export const useDmLocal = createDeviceSetting<DmLocal>({
  scope: "direct.local",
  defaults: { names: {}, closed: {}, closedAgents: {} },
  normalize: (stored) => {
    const value = (stored && typeof stored === "object" ? stored : {}) as Partial<DmLocal>;
    return {
      names: strings(value.names),
      closed: strings(value.closed),
      closedAgents: strings(value.closedAgents),
    };
  },
});

const change = (update: (current: DmLocal) => DmLocal) => useDmLocal.getState().set(update);

export function renameDm(id: string, name: string): void {
  const trimmed = name.trim();
  change((current) => {
    const names = { ...current.names };
    if (trimmed) names[id] = trimmed;
    else delete names[id];
    return { ...current, names };
  });
}

export function closeDm(id: string): void {
  change((current) => ({
    ...current,
    closed: { ...current.closed, [id]: new Date().toISOString() },
  }));
}

export function reopenDm(id: string): void {
  change((current) => {
    if (!(id in current.closed)) return current;
    const closed = { ...current.closed };
    delete closed[id];
    return { ...current, closed };
  });
}

const closedSince = (closedAt: string | undefined, lastAt: string | null | undefined) => {
  const at = Date.parse(closedAt ?? "");
  if (Number.isNaN(at)) return false;
  const last = lastAt ? Date.parse(lastAt) : NaN;
  return Number.isNaN(last) || last <= at;
};

export function dmClosed(dm: DirectConversation, local: DmLocal): boolean {
  return closedSince(local.closed[dm.id], dm.last_message_at);
}

export function closeAgentDm(agentId: string): void {
  change((current) => ({
    ...current,
    closedAgents: { ...current.closedAgents, [agentId]: new Date().toISOString() },
  }));
}

export function reopenAgentDm(agentId: string): void {
  change((current) => {
    if (!(agentId in current.closedAgents)) return current;
    const closedAgents = { ...current.closedAgents };
    delete closedAgents[agentId];
    return { ...current, closedAgents };
  });
}

export function agentDmClosed(agentId: string, lastAt: string, local: DmLocal): boolean {
  return closedSince(local.closedAgents[agentId], lastAt);
}

export const dmOwnName = (id: string): string | undefined => useDmLocal.getState().value.names[id];

export const useDmNames = () => useDmLocal((state) => state.value.names);
