import { Cloud } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import "./AgentAvatar.css";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { mistyEngine } from "../engines/enginesApi";
import { agentCloudAvatar, type agentCloudVariants } from "./agentCloudAvatars";

/**
 * An agent's picture. An agent on an outside engine wears that engine's own mark, or its initial
 * when the engine has none, drawn bare with nothing behind it. The cloud is Misty's own: it shows
 * for agents on Misty's runtime, and in the small size used in lists of chats it is a plain cloud
 * glyph, since the animated cloud belongs to the companion.
 */
export function AgentAvatar({
  agent,
  large = false,
  compact = false,
}: {
  agent?: AgentProfile;
  large?: boolean;
  compact?: boolean;
}) {
  const size = `agent-avatar${large ? " agent-avatar--large" : ""}${compact ? " agent-avatar--compact" : ""}`;
  const glyph = large ? 34 : compact ? 16 : 22;
  if (agent?.engine && agent.engine !== mistyEngine) {
    return (
      <span className={size} data-bare="true" aria-hidden="true">
        {hasEngineMark(agent.engine) ? (
          <EngineMark engine={agent.engine} size={glyph} />
        ) : (
          (agent.name.trim()[0] ?? "?").toUpperCase()
        )}
      </span>
    );
  }
  if (typeof agent?.avatar?.emoji === "string" && agent.avatar.emoji) {
    return (
      <span className={size} aria-hidden="true">
        {agent.avatar.emoji}
      </span>
    );
  }
  if (compact) {
    return (
      <span className={size} data-bare="true" aria-hidden="true">
        <Cloud size={glyph} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className={size} aria-hidden="true">
      <AgentCloudImage variant={agentCloudAvatar(agent)} />
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
