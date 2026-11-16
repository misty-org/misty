import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * The agents whose chats the sidebar has folded away, by agent id. Every group starts open; the
 * choice stays on this device in `misty.db`, like the sidebar's own width and collapse.
 */
export const useCollapsedAgents = createDeviceSetting<string[]>({
  scope: "sidebar-collapsed-agents",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
});

/** Folds an agent's chats away, or opens them again. */
export function toggleAgentChats(agentId: string) {
  useCollapsedAgents
    .getState()
    .set((ids) => (ids.includes(agentId) ? ids.filter((id) => id !== agentId) : [...ids, agentId]));
}
