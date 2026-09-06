import { useEffect, useMemo, useRef, useState } from "react";

import { socialApi as spacesApi } from "@/features/spaces/chat/socialRuntime";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { isAgentAuthoredMessage } from "./messageHelpers";

export interface ChatDisplayRow {
  message: SpaceMessage;
  compact: boolean;
  dateLabel: string;
}

const MESSAGE_GROUP_WINDOW_MS = 7 * 60 * 1000;

interface MemberAvatarRequest {
  memberId: string;
  version: number;
}

interface MemberAvatarCacheEntry extends MemberAvatarRequest {
  spaceId: string;
  url: string;
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

export function formatChatDateDivider(value: string): string {
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

/**
 * `first:mt-0` because the leading divider sits directly under the header,
 * where its own top margin only compounds the scroller's padding.
 */
export function ChatDateDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 first:mt-0" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-charcoal-border" />
      <span className="text-[11px] font-semibold text-cream-muted">{label}</span>
      <span className="h-px flex-1 bg-charcoal-border" />
    </div>
  );
}

export function useMemberAvatarUrls(
  spaceId: string,
  messages: SpaceMessage[],
): Map<string, string> {
  const avatarRequests = useMemo(() => {
    const versionsByMember = new Map<string, number>();
    messages.forEach((message) => {
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
  }, [messages]);
  const avatarRequestKey = useMemo(
    () => avatarRequests.map(({ memberId, version }) => `${memberId}:${version}`).join("|"),
    [avatarRequests],
  );
  const avatarRequestsRef = useRef<MemberAvatarRequest[]>(avatarRequests);
  const cacheRef = useRef<Map<string, MemberAvatarCacheEntry>>(new Map());
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());

  avatarRequestsRef.current = avatarRequests;

  useEffect(
    () => () => {
      cacheRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
      cacheRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    let canceled = false;
    const requests = avatarRequestsRef.current;
    const requestMemberIds = new Set(requests.map((request) => request.memberId));
    const cachedUrls = new Map<string, string>();
    const missingRequests = requests.filter((request) => {
      const cached = cacheRef.current.get(memberAvatarCacheKey(spaceId, request));
      if (!cached) return true;
      cachedUrls.set(request.memberId, cached.url);
      return false;
    });

    setUrls((current) => {
      const next = new Map(current);
      let changed = false;
      cachedUrls.forEach((url, memberId) => {
        if (next.get(memberId) !== url) {
          next.set(memberId, url);
          changed = true;
        }
      });
      next.forEach((_, memberId) => {
        if (!requestMemberIds.has(memberId)) {
          next.delete(memberId);
          changed = true;
        }
      });
      return changed ? next : current;
    });

    if (missingRequests.length === 0)
      return () => {
        canceled = true;
      };

    void Promise.all(
      missingRequests.map(async (request) => {
        try {
          const blob = await spacesApi.memberAvatar(spaceId, request.memberId);
          const url = URL.createObjectURL(blob);
          return { ...request, spaceId, url };
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      const loadedEntries = entries.filter((entry) => entry !== null);
      if (canceled) {
        loadedEntries.forEach((entry) => URL.revokeObjectURL(entry.url));
        return;
      }

      setUrls((current) => {
        const next = new Map(current);
        let changed = false;
        loadedEntries.forEach((entry) => {
          cacheRef.current.forEach((cached, key) => {
            if (
              cached.spaceId === entry.spaceId &&
              cached.memberId === entry.memberId &&
              key !== memberAvatarCacheKey(entry.spaceId, entry)
            ) {
              URL.revokeObjectURL(cached.url);
              cacheRef.current.delete(key);
            }
          });
          cacheRef.current.set(memberAvatarCacheKey(entry.spaceId, entry), entry);
          if (next.get(entry.memberId) !== entry.url) {
            next.set(entry.memberId, entry.url);
            changed = true;
          }
        });
        return changed ? next : current;
      });
    });

    return () => {
      canceled = true;
    };
  }, [avatarRequestKey, spaceId]);

  return urls;
}

function memberAvatarCacheKey(spaceId: string, request: MemberAvatarRequest): string {
  return [spaceId, request.memberId, request.version].join(":");
}
