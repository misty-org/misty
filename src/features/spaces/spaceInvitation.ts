import type { Space, SpaceInvitation } from "@/api/spaces/dto/interfaces/types";

/** A restricted Space-shaped preview used until an invitation is accepted. */
export function invitedSpacePreview(invitation: SpaceInvitation): Space {
  return {
    id: invitation.space_id,
    is_default: false,
    owner_user_id: invitation.invited_by_user_id,
    name: invitation.space_name,
    role: "member",
    member_count: 0,
    pending_count: 1,
    is_shared: true,
    permissions: {
      "messages.read": false,
      "messages.write": false,
      "library.view": false,
    },
    created_at: invitation.created_at,
    updated_at: invitation.created_at,
  };
}
