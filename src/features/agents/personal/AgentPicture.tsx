// Kept apart from AgentAvatar.tsx so windows without the agents' store (the cursor overlay) can
// draw an agent from its profile alone.
import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, PersonaLogo, personaTone, Surface, Text } from "@misty/ui";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { mistyEngine } from "../engines/mistyEngine";
import { agentCloudAvatar, type agentCloudVariants } from "./agentCloudAvatars";
import { personaGlyph } from "../personas/personaGlyph";

/**
 * An agent's picture. An agent made from a persona wears the persona's logo, as Explore shows it.
 * Otherwise an agent on an outside engine wears that engine's own mark, or its initial
 * when the engine has none, drawn bare with nothing behind it. The cloud is Misty's own: it shows
 * for agents on Misty's runtime, and in the small size used in lists of chats it is a plain cloud
 * glyph, since the animated cloud belongs to the companion.
 */
export function AgentAvatar({
  agent,
  large = false,
  compact = false,
  className,
}: {
  agent?: AgentProfile;
  large?: boolean;
  compact?: boolean;
  /** Layout only: a box of another size, such as a profile's 64px picker. */
  className?: string;
}) {
  const glyph = large ? 34 : compact ? 16 : 22;
  // `agent-avatar` stays as a hook: the sidebar and search draw the mark at icon size by it.
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
          size={large ? "tile" : compact ? "row" : "avatar"}
        />
      </span>
    );
  }
  if (agent?.engine && agent.engine !== mistyEngine) {
    return frame(
      true,
      false,
      hasEngineMark(agent.engine) ? (
        <EngineMark engine={agent.engine} size={glyph} />
      ) : (
        (agent.name.trim()[0] ?? "?").toUpperCase()
      ),
    );
  }
  if (typeof agent?.avatar?.emoji === "string" && agent.avatar.emoji) {
    return frame(false, true, agent.avatar.emoji);
  }
  if (compact) return frame(true, false, <Cloud />);
  return frame(false, false, <AgentCloudImage variant={agentCloudAvatar(agent)} fill />);
}

/**
 * One of the cloud's pictures, still when motion is reduced. `fill` makes it fill its box, the
 * picture contained in it; without it the picture keeps its own size up to its box's width.
 */
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
