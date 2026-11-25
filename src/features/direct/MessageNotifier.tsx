import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { conversationPath, isChatOnScreen, spaceChatPath, useSpacesStore } from "@/features/spaces";
import { noticesMuted, useMessageNotices } from "@/shared/lib/message_notices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { dmName, dmPath, peekDm } from "./direct_data";
import { playCallSound } from "./calls/call_sounds";
import { isDoNotDisturb } from "./status_store";

interface MessageLike {
  id?: unknown;
  sender_user_id?: unknown;
  sender_name?: unknown;
  sender_kind?: unknown;
  thread_root_id?: unknown;
  content?: unknown;
}

function lineOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((span: { text?: unknown; label?: unknown; type?: unknown }) =>
      span.type === "mention"
        ? `@${String(span.label ?? "")}`
        : String(span.text ?? span.label ?? ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(content: unknown, userId: string, roleIds: readonly string[]): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (span: { type?: unknown; user_id?: unknown; role_id?: unknown }) =>
        span.type === "mention" &&
        (span.user_id === userId ||
          (typeof span.role_id === "string" && roleIds.includes(span.role_id))),
    )
  );
}

function myRoleIds(spaceId: string, userId: string): string[] {
  return (
    useSpacesStore.getState().membersBySpace[spaceId]?.find((member) => member.user_id === userId)
      ?.role_ids ?? []
  );
}

const noticedLimit = 500;
const noticed = new Set<string>();

function remember(messageId: string) {
  noticed.add(messageId);
  if (noticed.size <= noticedLimit) return;
  const oldest = noticed.values().next().value;
  if (oldest !== undefined) noticed.delete(oldest);
}

export function MessageNotifier({ accountId }: { accountId: string }) {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const onMessage = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          event?: { type?: string; payload?: MessageLike & { message_id?: unknown } };
          quiet?: boolean;
        }>
      ).detail;
      const spaceId = detail?.spaceId;
      const message = detail?.event?.payload;
      const type = detail?.event?.type;
      if (!spaceId || !message || detail?.quiet) return;
      if (type !== "message.created" && type !== "message.updated") return;
      const messageId = type === "message.updated" ? message.message_id : message.id;
      if (typeof messageId !== "string" || noticed.has(messageId)) return;
      if (message.sender_user_id === accountId || message.sender_kind === "system") return;
      if (typeof message.sender_user_id !== "string") return;
      const mentioned = mentions(message.content, accountId, myRoleIds(spaceId, accountId));
      if (type === "message.updated" && !mentioned) return;
      if (isDoNotDisturb()) return;
      const prefs = useMessageNotices.getState().value;
      const conversationId = detail.conversationId ?? "";
      const dm = peekDm(spaceId);
      const sender = String(message.sender_name ?? "").trim() || "Someone";
      let title: string;
      let route: string;
      if (dm) {
        if (!prefs.direct || noticesMuted(prefs, spaceId)) return;
        title = dm.kind === "group" ? `${sender} in ${dmName(dm, accountId)}` : sender;
        route = dmPath(spaceId);
      } else {
        if (prefs.spaces === "off") return;
        if (prefs.spaces === "mentions" && !mentioned) return;
        if (!mentioned && noticesMuted(prefs, spaceId, conversationId)) return;
        const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
        title = space ? `${sender} in ${space.name}` : sender;
        route = conversationId
          ? conversationPath(spaceId, { id: conversationId })
          : spaceChatPath(spaceId);
      }
      if (isChatOnScreen(spaceId, conversationId)) return;
      remember(messageId);
      if (prefs.sound) playCallSound("message");
      if (document.hasFocus()) return;
      void invoke("chat_message_notify", {
        messageId,
        title,
        body: lineOf(message.content),
        route,
      }).catch(() => undefined);
    };
    window.addEventListener("misty:space-message-event", onMessage);
    return () => window.removeEventListener("misty:space-message-event", onMessage);
  }, [accountId]);
  return null;
}
