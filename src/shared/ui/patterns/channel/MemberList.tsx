import type { ComponentProps, ReactNode } from "react";
import { Crown } from "lucide-react";

import { cn } from "../../classNames";
import { Pressable } from "../../controls/Pressable";
import { OverflowFadeText } from "../../layout/OverflowFadeText";
import { RoleName } from "../../display/RoleName";
import { Text } from "../../display/Text";
import { Tooltip } from "../../overlays/Tooltip";

/** The member list beside a channel's messages, on the channel's own fill, as Discord's. */
export function MemberList(props: { label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={props.label}
      className="flex h-full min-h-0 w-60 shrink-0 flex-col overflow-y-auto px-2 pb-4"
    >
      {props.children}
    </aside>
  );
}

/** A group's heading: its name, a dash and how many are in it ("Online — 3"). */
export function MemberGroupHeading(props: { title: string; count: number }) {
  return (
    <Text as="h3" size="caption" weight="semibold" tone="muted" className="px-2 pt-5 pb-1">
      {`${props.title} — ${props.count}`}
    </Text>
  );
}

/** `working`: their agent is at work; `waiting`: it waits on them; `offline` dims the row. */
export type MemberPresence = "online" | "working" | "waiting" | "offline";

const dotClass: Record<MemberPresence, string> = {
  online: "bg-[var(--tone-done)]",
  working: "bg-[var(--tone-working)]",
  waiting: "bg-[var(--tone-waiting)]",
  offline: "hidden",
};

/**
 * One person: their face with a presence dot, their name in their role's color with a crown
 * for the Space's owner, and a quiet second line (what their agent is doing).
 */
export function MemberRow({
  avatar,
  name,
  color,
  owner,
  presence,
  lineMark,
  line,
  onOpen,
  className,
  ...rest
}: Omit<ComponentProps<typeof Pressable>, "children" | "wash"> & {
  avatar: ReactNode;
  name: string;
  color?: string;
  owner?: boolean;
  presence: MemberPresence;
  /** A small mark before the line, such as the agent's engine. */
  lineMark?: ReactNode;
  line?: string;
  onOpen?: () => void;
}) {
  const props = { avatar, name, color, owner, presence, lineMark, line };
  return (
    <Pressable
      type="button"
      wash="row"
      onClick={onOpen}
      {...rest}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-1 text-left",
        presence === "offline" && "opacity-30 hover:opacity-100 data-[state=open]:opacity-100",
        className,
      )}
    >
      <span className="relative shrink-0">
        {props.avatar}
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-charcoal-card",
            dotClass[props.presence],
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-body">
          <OverflowFadeText className="min-w-0">
            <RoleName color={props.presence === "offline" ? undefined : props.color}>
              {props.name}
            </RoleName>
          </OverflowFadeText>
          {props.owner ? (
            <Tooltip content="Space owner">
              <span className="shrink-0 text-[var(--tone-waiting)] [&_svg]:size-3.5">
                <Crown aria-label="Space owner" />
              </span>
            </Tooltip>
          ) : null}
        </span>
        {props.line ? (
          <span className="flex min-w-0 items-center gap-1">
            {props.lineMark}
            <OverflowFadeText className="min-w-0 text-caption text-cream-muted">
              {props.line}
            </OverflowFadeText>
          </span>
        ) : null}
      </span>
    </Pressable>
  );
}
