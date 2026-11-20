import { useUserStore } from "@/features/account/core";
import type { Space } from "../api/dto/entities";
import { FluxerChatRoot } from "../chat/fluxer/FluxerChatRoot";
import { FluxerMemberList } from "../chat/fluxer/FluxerMemberList";

/**
 * The members of a Space beside its home, grouped as the Space chat groups them: whose agents are working,
 * who is online, who is offline. A header button shows and hides it.
 */
export function SpaceMembersPanel({ space }: { space: Space }) {
  const me = useUserStore((state) => state.me?.id);
  return (
    <FluxerChatRoot className="h-full w-60 shrink-0">
      <FluxerMemberList
        space={space}
        spaceId={space.id}
        ownerUserId={space.owner_user_id}
        currentUserId={me}
      />
    </FluxerChatRoot>
  );
}
