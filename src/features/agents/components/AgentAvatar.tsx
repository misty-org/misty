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
    <span
      className="agent-brand-image"
      aria-hidden="true"
      style={{
        backgroundColor: variant.color,
        mask: `url("${variant.src}") center / 80% 80% no-repeat`,
        WebkitMask: `url("${variant.src}") center / 80% 80% no-repeat`,
      }}
    />
  );
}
