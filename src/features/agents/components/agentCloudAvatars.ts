import type { AgentProfile } from "@misty/contracts";
import sky from "@/shared/assets/misty-cloud-expression-cycle.webp";
import lavender from "@/shared/assets/agents/cloud-lavender.webp";
import mint from "@/shared/assets/agents/cloud-mint.webp";
import peach from "@/shared/assets/agents/cloud-peach.webp";

import skyPoster from "@/shared/assets/agents/cloud-sky-poster.webp";
import lavenderPoster from "@/shared/assets/agents/cloud-lavender-poster.webp";
import mintPoster from "@/shared/assets/agents/cloud-mint-poster.webp";
import peachPoster from "@/shared/assets/agents/cloud-peach-poster.webp";

export const agentCloudVariants = [
  { id: "sky", name: "Sky", expression: "Original", src: sky, poster: skyPoster },
  { id: "lavender", name: "Lavender", expression: "Wink", src: lavender, poster: lavenderPoster },
  { id: "mint", name: "Mint", expression: "Focused", src: mint, poster: mintPoster },
  { id: "peach", name: "Peach", expression: "Joyful", src: peach, poster: peachPoster },
] as const;

export function agentCloudAvatar(
  agent?: Pick<AgentProfile, "id" | "name" | "avatar" | "system_managed">,
) {
  const selected = agentCloudVariants.find((variant) => variant.id === agent?.avatar?.cloudVariant);
  if (selected) return selected;
  if (!agent || agent.system_managed) return agentCloudVariants[0];
  // Stable identities for agents that predate the cloud picker; renaming does not change color.
  const seed = agent.id || agent.name;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  return agentCloudVariants[1 + (hash % (agentCloudVariants.length - 1))];
}
