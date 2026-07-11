import "./AgentAvatar.css";
import type { AgentProfile } from "@/shared/contracts";
import { agentCloudAvatar, type agentCloudVariants } from "./agentCloudAvatars";

export function AgentAvatar({ agent, large = false }: { agent?: AgentProfile; large?: boolean }) {
  return (
    <span className={`agent-avatar${large ? " agent-avatar--large" : ""}`} aria-hidden="true">
      {typeof agent?.avatar?.emoji === "string" && agent.avatar.emoji ? (
        agent.avatar.emoji
      ) : (
        <AgentCloudImage variant={agentCloudAvatar(agent)} />
      )}
    </span>
  );
}

export function AgentCloudImage({ variant }: { variant: (typeof agentCloudVariants)[number] }) {
  return (
    <picture className="agent-cloud-image">
      <source media="(prefers-reduced-motion: reduce)" srcSet={variant.poster} />
      <img src={variant.src} width={512} height={512} alt="" draggable={false} />
    </picture>
  );
}
