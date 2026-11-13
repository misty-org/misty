import { usePersonalAgentsStore } from "./personalAgentsStore";
import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { cn, Surface, Text } from "@/shared/ui";
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

/**
 * An agent known only by its id (a Space message's sender, a mention, a task's assignee), drawn
 * as `AgentAvatar` draws it: its engine's logo. An agent this device doesn't know shows Misty's
 * own mark, never a generic agent glyph.
 */
export function AgentMark({ agentId }: { agentId?: string }) {
  const agent = usePersonalAgentsStore((state) =>
    agentId ? state.agents.find((item) => item.id === agentId) : undefined,
  );
  return <AgentAvatar agent={agent} compact />;
}
