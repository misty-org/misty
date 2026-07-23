import { useEffect, useMemo, useState } from "react";

import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export interface ChatDisplayRow {
  message: SpaceMessage;
  compact: boolean;
  dateLabel: string;
}

const MESSAGE_GROUP_WINDOW_MS = 7 * 60 * 1000;

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
  if (message.origin?.system && message.origin.system !== "misty") {
    return [
      message.origin.system,
      message.origin.author_handle || message.origin.author_name || message.sender_name,
    ].join(":");
  }
  return [
    message.sender_kind,
    message.sender_agent_id || message.sender_user_id || message.sender_name,
  ].join(":");
}

export function ChatDateDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border/70" />
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}

export function useMemberAvatarUrls(
  spaceId: string,
  messages: SpaceMessage[],
): Map<string, string> {
  const memberIds = useMemo(
    () =>
      Array.from(
        new Set(
          messages
            .filter(
              (message) =>
                message.sender_kind === "person" &&
                message.sender_user_id &&
                (message.sender_avatar_version ?? 0) > 0 &&
                !message.origin?.author_avatar_url,
            )
            .map((message) => message.sender_user_id),
        ),
      ).sort(),
    [messages],
  );
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let canceled = false;
    const objectUrls: string[] = [];
    setUrls(new Map());
    void Promise.all(
      memberIds.map(async (memberId) => {
        try {
          const blob = await spacesApi.memberAvatar(spaceId, memberId);
          if (canceled) return null;
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          return [memberId, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!canceled) setUrls(new Map(entries.filter((entry) => entry !== null)));
    });
    return () => {
      canceled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [memberIds, spaceId]);

  return urls;
}
