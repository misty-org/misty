import { useEffect, useMemo, useRef, useState } from "react";

import { ChannelDivider } from "@misty/ui";

import { memberPicture } from "../../members/member_pictures";
import { useSpacesStore } from "../../list/use_spaces_store";
import type { SpaceMessage } from "../../api/dto/entities";
import { isAgentAuthoredMessage } from "./message_text";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { usePicturePreviews } from "@/shared/lib/picture_previews";
import { readyPicture } from "@/shared/lib/versioned_picture";

interface ChatDisplayRow {
  message: SpaceMessage;
  compact: boolean;
  dateLabel: string;
}

const MESSAGE_GROUP_WINDOW_MS = 7 * 60 * 1000;

interface MemberAvatarRequest {
  memberId: string;
  version: number;
}

export function buildChatDisplayRows(messages: SpaceMessage[]): ChatDisplayRow[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const beginsDate = !previous || !sameLocalDate(previous.created_at, message.created_at);
    const elapsed = previous
      ? new Date(message.created_at).getTime() - new Date(previous.created_at).getTime()
      : Number.POSITIVE_INFINITY;
    const compact = Boolean(
      previous &&
      !beginsDate &&
      !message.reply_to_message_id &&
      messageIdentity(previous) === messageIdentity(message) &&
      elapsed >= 0 &&
      elapsed <= MESSAGE_GROUP_WINDOW_MS,
    );
    return {
      message,
      compact,
      dateLabel: beginsDate ? formatChatDateDivider(message.created_at) : "",
    };
  });
}

export function formatChatMessageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatChatMessageStamp(value: string, now = new Date()): string {
  const date = new Date(value);
  const time = formatChatMessageTime(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDate(date.toISOString(), now.toISOString())) return `Today at ${time}`;
  if (sameLocalDate(date.toISOString(), yesterday.toISOString())) return `Yesterday at ${time}`;
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(date)} ${time}`;
}

function formatChatDateDivider(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function sameLocalDate(left: string, right: string): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function messageIdentity(message: SpaceMessage): string {
  if (message.origin?.kind === "misty_assistant") return "misty:managed";
  return [
    isAgentAuthoredMessage(message) ? "agent" : message.sender_kind,
    message.sender_agent_id || message.sender_user_id || message.sender_name,
  ].join(":");
}

export function ChatDateDivider({ label }: { label: string }) {
  return <ChannelDivider label={label} />;
}

export function messageSenderOutline(message: SpaceMessage): string | undefined {
  if (message.sender_kind !== "person" || message.origin?.author_avatar_url) return undefined;
  return (
    avatarOutline(message.sender_avatar_decoration) ??
    avatarOutline(message.sender?.avatar_decoration)
  );
}

export function memberOutlineFor(
  outlines: Map<string, string>,
  message: SpaceMessage,
): string | undefined {
  if (message.sender_kind !== "person" || message.origin?.author_avatar_url) return undefined;
  return outlines.get(message.sender_user_id);
}

export function useMemberOutlines(
  spaceId: string,
  messages: SpaceMessage[],
): Map<string, string> {
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  return useMemo(() => {
    const outlines = new Map<string, string>();
    const known = new Set<string>();
    (members ?? []).forEach((member) => {
      known.add(member.user_id);
      const outline = avatarOutline(member.avatar_decoration);
      if (outline) outlines.set(member.user_id, outline);
    });
    messages.forEach((message) => {
      const userId = message.sender_user_id;
      if (message.sender_kind !== "person" || !userId || known.has(userId)) return;
      if (message.origin?.author_avatar_url) return;
      const outline = messageSenderOutline(message);
      if (outline) outlines.set(userId, outline);
      else outlines.delete(userId);
    });
    return outlines;
  }, [members, messages]);
}

export function useMemberAvatarUrls(
  spaceId: string,
  messages: SpaceMessage[],
): Map<string, string> {
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const avatarRequests = useMemo(() => {
    const versionsByMember = new Map<string, number>();
    const current = new Map(
      (members ?? []).map((member) => [member.user_id, member.avatar_version ?? 0] as const),
    );
    messages.forEach((message) => {
      if (message.sender_kind === "person" && message.sender_user_id) {
        const now = current.get(message.sender_user_id);
        if (now !== undefined) {
          if (now > 0) versionsByMember.set(message.sender_user_id, now);
          return;
        }
      }
      if (
        message.sender_kind !== "person" ||
        !message.sender_user_id ||
        (message.sender_avatar_version ?? 0) <= 0
      ) {
        return;
      }
      versionsByMember.set(
        message.sender_user_id,
        Math.max(
          versionsByMember.get(message.sender_user_id) ?? 0,
          message.sender_avatar_version ?? 0,
        ),
      );
    });
    return Array.from(versionsByMember, ([memberId, version]) => ({ memberId, version })).sort(
      (left, right) => left.memberId.localeCompare(right.memberId),
    );
  }, [members, messages]);
  const avatarRequestKey = useMemo(
    () => avatarRequests.map(({ memberId, version }) => `${memberId}:${version}`).join("|"),
    [avatarRequests],
  );
  const avatarRequestsRef = useRef<MemberAvatarRequest[]>(avatarRequests);
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const previews = usePicturePreviews();

  avatarRequestsRef.current = avatarRequests;

  useEffect(() => {
    let canceled = false;
    const requests = avatarRequestsRef.current;
    const wanted = new Set(requests.map((request) => request.memberId));
    const known = new Map<string, string>();
    const missing = requests.filter((request) => {
      const url = readyPicture(`person:${request.memberId}`, request.version);
      if (url === undefined) return true;
      if (url) known.set(request.memberId, url);
      return false;
    });
    setUrls((current) => {
      const next = new Map(current);
      let changed = false;
      known.forEach((url, memberId) => {
        if (next.get(memberId) !== url) {
          next.set(memberId, url);
          changed = true;
        }
      });
      next.forEach((_, memberId) => {
        if (!wanted.has(memberId)) {
          next.delete(memberId);
          changed = true;
        }
      });
      return changed ? next : current;
    });
    missing.forEach((request) => {
      void memberPicture(request.memberId, request.version).then((url) => {
        if (canceled || !url) return;
        setUrls((current) =>
          current.get(request.memberId) === url
            ? current
            : new Map(current).set(request.memberId, url),
        );
      });
    });
    return () => {
      canceled = true;
    };
  }, [avatarRequestKey, spaceId]);

  return useMemo(() => {
    let shown = urls;
    for (const { memberId } of avatarRequests) {
      const preview = previews.get(`person:${memberId}`);
      if (!preview || shown.get(memberId) === preview) continue;
      if (shown === urls) shown = new Map(urls);
      shown.set(memberId, preview);
    }
    return shown;
  }, [urls, previews, avatarRequests]);
}
