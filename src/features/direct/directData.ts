import { useEffect } from "react";
import {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "@/features/spaces";
import { directApi, type DirectConversation, type FriendsList } from "./api";

const friendsPath = "/friends";
const dmsPath = "/dms";

/** The person's friends, pending requests both ways and blocks: the last copy at once, then fresh. */
export function useFriends() {
  return useSpaceResource<FriendsList>(friendsPath, directApi.friends);
}

export function reloadFriends() {
  return refreshSpaceResource(friendsPath, directApi.friends);
}

/** The person's DMs, the most recently active first. */
export function useDms() {
  return useSpaceResource<DirectConversation[]>(dmsPath, directApi.dms);
}

export function reloadDms() {
  return refreshSpaceResource(dmsPath, directApi.dms);
}

/** Changes the DM list every screen shows, such as a DM read here. */
export function updateDms(next: (current: DirectConversation[]) => DirectConversation[]) {
  setSpaceResource<DirectConversation[]>(dmsPath, (previous) => next(previous ?? []));
}

/** A DM the person has, from the copy this session holds. */
export function peekDm(dmId: string): DirectConversation | undefined {
  return peekSpaceResource<DirectConversation[]>(dmsPath)?.find((dm) => dm.id === dmId);
}

/** Whether this Space id is one of the person's DMs. */
export function isDmId(spaceId: string): boolean {
  return Boolean(peekDm(spaceId));
}

/**
 * Keeps the DM list current: a DM's own changes, and any message in a DM (for its unread count and
 * order), read the list again. Mounted once, by the Personal sidebar.
 */
export function useDmListUpdates() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reloadDms().catch(() => undefined), 300);
    };
    const onMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string }>).detail;
      if (detail?.spaceId && isDmId(detail.spaceId)) soon();
    };
    window.addEventListener("misty:direct-event", soon);
    window.addEventListener("misty:space-message-event", onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("misty:direct-event", soon);
      window.removeEventListener("misty:space-message-event", onMessage);
    };
  }, []);
}

/** The other person in a one-to-one DM, or everyone else in a group, for its name and face. */
export function dmOthers(dm: DirectConversation, myUserId: string | undefined) {
  return dm.members.filter((member) => member.user_id !== myUserId);
}

/** A DM's name: the other person's username, or the group's people joined. */
export function dmName(dm: DirectConversation, myUserId: string | undefined): string {
  const others = dmOthers(dm, myUserId);
  if (!others.length) return "Just you";
  return others.map((member) => member.username).join(", ");
}

/** Where a DM opens. */
export const dmPath = (dmId: string) => `/dms/${encodeURIComponent(dmId)}`;
export const friendsRoute = "/friends";
