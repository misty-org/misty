import type { AgentProfile } from "@/shared/contracts";
import mark from "@/assets/branding/misty-white.png?inline";

// Keep the persisted IDs and cloudVariant field compatible with existing profiles.
export const agentCloudVariants = [
  { id: "sky", name: "Sky", expression: "Misty", src: mark, color: "#9bd6f4" },
  { id: "lavender", name: "Lavender", expression: "Misty", src: mark, color: "#c7b5f4" },
  { id: "mint", name: "Mint", expression: "Misty", src: mark, color: "#a9dfc7" },
  { id: "peach", name: "Peach", expression: "Misty", src: mark, color: "#f4c2a8" },
] as const;

export function agentCloudAvatar(
  agent?: Pick<AgentProfile, "id" | "name" | "avatar" | "system_managed">,
) {
  const selected = agentCloudVariants.find((variant) => variant.id === agent?.avatar?.cloudVariant);
  if (selected) return selected;
  if (!agent || agent.system_managed) return agentCloudVariants[0];
  // Stable identities for agents that predate the color picker; renaming does not change color.
  const seed = agent.id || agent.name;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  return agentCloudVariants[1 + (hash % (agentCloudVariants.length - 1))];
}
