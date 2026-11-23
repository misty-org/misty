import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, hasMark, Mark, PersonaLogo, personaTone, Surface, Text } from "@misty/ui";
import { mistyEngine } from "../engines/misty_engine";
import { agentCloudAvatar, type agentCloudVariants } from "./agent_cloud_avatars";
import { personaGlyph } from "../personas/persona_glyph";

export function AgentAvatar({
  agent,
  large = false,
  compact = false,
  face = false,
  className,
}: {
  agent?: AgentProfile;
  large?: boolean;
  compact?: boolean;
  face?: boolean;
  className?: string;
}) {
  const glyph = large ? 34 : compact && !face ? 16 : 22;
  const frame = (bare: boolean, disc: boolean, children: ReactNode) => (
    <Surface
      as="span"
      tone={disc ? "active" : "none"}
      radius={bare ? "none" : "full"}
      data-bare={bare || undefined}
      aria-hidden="true"
      className={cn(
        "agent-avatar inline-flex shrink-0 items-center justify-center",
        bare ? "overflow-visible" : "overflow-hidden",
        large
          ? "size-16 text-display"
          : face
            ? bare
              ? "size-6 text-control"
              : "size-6 text-caption"
            : compact
              ? bare
                ? "size-4.5 text-meta"
                : "size-7 text-caption"
              : "size-10 text-title",
        className,
      )}
    >
      <Text
        bare
        tone={bare ? "default" : "bright"}
        weight={bare ? "semibold" : "medium"}
        className="contents"
      >
        {children}
      </Text>
    </Surface>
  );
  const avatar = agent?.avatar as
    { kind?: unknown; persona?: unknown; division?: unknown } | undefined;
  if (avatar?.kind === "persona" && typeof avatar.persona === "string") {
    const persona = { id: avatar.persona, divisionId: String(avatar.division ?? "") };
    return (
      <span aria-hidden="true" className={cn("agent-avatar inline-flex shrink-0", className)}>
        <PersonaLogo
          icon={personaGlyph(persona)}
          color={personaTone(persona.id)}
          size={large ? "tile" : compact || face ? "row" : "avatar"}
        />
      </span>
    );
  }
  if (agent?.engine && agent.engine !== mistyEngine) {
    return frame(
      true,
      false,
      hasMark(`engine:${agent.engine}`) ? (
        <Mark of={`engine:${agent.engine}`} size={glyph} />
      ) : (
        (agent.name.trim()[0] ?? "?").toUpperCase()
      ),
    );
  }
  if (typeof agent?.avatar?.emoji === "string" && agent.avatar.emoji) {
    return frame(false, true, agent.avatar.emoji);
  }
  if (compact || face) return frame(true, false, <Cloud />);
  return frame(false, false, <AgentCloudImage variant={agentCloudAvatar(agent)} fill />);
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
