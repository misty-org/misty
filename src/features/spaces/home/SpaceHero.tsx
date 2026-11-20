import type { ReactNode } from "react";
import { Text } from "@misty/ui";
import type { Space } from "../api/dto/entities";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { spaceNavigationName } from "../routes/defaultSpace";

/**
 * The top of a Space's home: its icon, its name, who is online and how many are in it, with the Space's
 * own actions (make something, its options) at the right.
 */
export function SpaceHero({
  space,
  online,
  actions,
}: {
  space: Space;
  /** People in the Space right now, the person included. */
  online: number;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 pb-2">
      <SpaceAvatar
        space={space}
        className="size-16 shrink-0 rounded-2xl"
        fallbackClassName="text-display font-bold"
      />
      <div className="grid min-w-0 gap-0.5">
        <Text as="h1" tone="bright" size="title" weight="semibold" className="m-0">
          {spaceNavigationName(space)}
        </Text>
        <Text size="control" tone="muted" className="flex items-center gap-3">
          {online > 0 ? <span>{`${online} online`}</span> : null}
          <span>{`${space.member_count} ${space.member_count === 1 ? "member" : "members"}`}</span>
        </Text>
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
