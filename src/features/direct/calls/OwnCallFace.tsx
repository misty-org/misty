import { Avatar, AvatarFallback, AvatarImage } from "@misty/ui";
import { useAccountAvatarUrl, useUserStore } from "@/features/account";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { personInitials } from "@/shared/lib/person_initials";
import { personTone } from "@/shared/lib/person_tone";

export function useOwnCallName(): string {
  return useUserStore((state) => state.me?.username ?? "");
}

export function OwnCallFace({ id }: { id: string }) {
  const accountId = useUserStore((state) => state.me?.id);
  const version = useUserStore((state) => state.me?.avatar_version ?? 0);
  const decoration = useUserStore((state) => state.me?.avatar_decoration);
  const name = useOwnCallName();
  const picture = useAccountAvatarUrl(accountId, version);
  return (
    <Avatar size="xl" tone={personTone(id || name)} outline={avatarOutline(decoration)}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
