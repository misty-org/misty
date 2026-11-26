import { Cloud } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import { personTone } from "@/shared/lib/person_tone";
import { AgentFace, cn, hasMark, personaTone, type AvatarSize } from "@misty/ui";
import { mistyEngine } from "../engines/misty_engine";
import { agentCloudAvatar, type agentCloudVariants } from "./agent_cloud_avatars";
import { personaGlyph } from "../personas/persona_glyph";

export function AgentAvatar({
  agent,
  large = false,
  compact = false,
  face = false,
  glyph = false,
  className,
}: {
  agent?: AgentProfile;
  large?: boolean;
  compact?: boolean;
  face?: boolean;
  glyph?: boolean;
  className?: string;
}) {
  const size: AvatarSize = large ? "xl" : glyph ? "glyph" : face ? "sm" : compact ? "xs" : "lg";
  const faceClass = cn("agent-avatar", className);
  const tone = agent ? personTone(agent.id) : undefined;
  const avatar = agent?.avatar as
    { kind?: unknown; persona?: unknown; division?: unknown } | undefined;
  if (avatar?.kind === "persona" && typeof avatar.persona === "string") {
    const persona = { id: avatar.persona, divisionId: String(avatar.division ?? "") };
    return (
      <AgentFace
        size={size}
        icon={personaGlyph(persona)}
        color={personaTone(persona.id)}
        className={faceClass}
      />
    );
  }
  if (agent?.engine && agent.engine !== mistyEngine) {
    const mark = `engine:${agent.engine}`;
    return hasMark(mark) ? (
      <AgentFace size={size} mark={mark} tone={tone} className={faceClass} />
    ) : (
      <AgentFace size={size} tone={tone} className={faceClass}>
        {(agent.name.trim()[0] ?? "?").toUpperCase()}
      </AgentFace>
    );
  }
  if (typeof agent?.avatar?.emoji === "string" && agent.avatar.emoji) {
    return (
      <AgentFace size={size} tone={tone} className={faceClass}>
        {agent.avatar.emoji}
      </AgentFace>
    );
  }
  if (compact || face || glyph)
    return <AgentFace size={size} icon={Cloud} tone={tone} className={faceClass} />;
  return (
    <AgentFace size={size} picture className={faceClass}>
      <AgentCloudImage variant={agentCloudAvatar(agent)} fill />
    </AgentFace>
  );
}

export function AgentCloudImage({
  variant,
  fill = false,
}: {
  variant: (typeof agentCloudVariants)[number];
  fill?: boolean;
}) {
  return (
    <picture className={cn("block shrink-0", fill && "size-full")}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={variant.poster} />
      <img
        src={variant.src}
        width={512}
        height={512}
        alt=""
        draggable={false}
        className={cn("block", fill && "size-full object-contain")}
      />
    </picture>
  );
}
