import { Avatar, AvatarFallback, AvatarImage } from "@misty/ui";
import { useAccountAvatarUrl } from "@/features/account";
import { useUserStore } from "@/features/account/core";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import { avatarOutline } from "@/shared/lib/avatar_decoration";

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "short" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

export function useYou() {
  const id = useUserStore((state) => state.me?.id || state.accountId);
  const name = useUserStore((state) => state.me?.username || state.me?.email?.split("@")[0] || "");
  const version = useUserStore((state) => state.me?.avatar_version ?? 0);
  const picture = useAccountAvatarUrl(id, version);
  const outline = useUserStore((state) => avatarOutline(state.me?.avatar_decoration));
  return { id, name: name || "You", picture, outline };
}

export function YouFace({ you }: { you: ReturnType<typeof useYou> }) {
  return (
    <Avatar size="lg" tone={personTone(you.id || you.name)} outline={you.outline}>
      {you.picture ? <AvatarImage src={you.picture} alt="" /> : null}
      <AvatarFallback>{personInitials(you.name)}</AvatarFallback>
    </Avatar>
  );
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function messageStamp(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { time: "", full: "" };
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = clock.format(date);
  return {
    time: sameDay(date, now)
      ? `Today at ${time}`
      : sameDay(date, yesterday)
        ? `Yesterday at ${time}`
        : `${day.format(date)} ${time}`,
    full: full.format(date),
  };
}
