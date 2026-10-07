import { useShallow } from "zustand/react/shallow";
import type { Space } from "@/api/spaces/dto/entities";
import { Button } from "@/shared/ui";
import { SpaceMembersPopover } from "../members";
import { useSpacesStore } from "../store/useSpacesStore";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Who's in the Space, as a few faces and a count; it opens the member list. */
export function SpaceHomeMembers({ space }: { space: Space }) {
  const members = useSpacesStore(useShallow((state) => state.membersBySpace[space.id] ?? []));
  const shown = members.slice(0, 3);
  return (
    <SpaceMembersPopover
      space={space}
      side="bottom"
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-2 px-2"
          aria-label={`Members: ${members.length || "show"}`}
        >
          <span className="flex">
            {shown.map((member, index) => (
              <span
                key={member.user_id}
                className="grid size-6 place-items-center rounded-full border-2 border-charcoal-workspace bg-charcoal-active text-[10px] text-cream"
                style={{ marginLeft: index ? -8 : 0 }}
                aria-hidden
              >
                {initials(member.name)}
              </span>
            ))}
          </span>
          {members.length > 0 ? members.length : "Members"}
        </Button>
      }
    />
  );
}
