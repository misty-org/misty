import { useEffect } from "react";
import {
  peekSpaceResource,
  provideDirectSpaceCheck,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "@/features/spaces";
import {
  directApi,
  type DirectConversation,
  type FriendsList,
  type Person,
  type SharedSpace,
} from "./api";

const friendsPath = "/friends";
const dmsPath = "/dms";

export function useFriends() {
  return useSpaceResource<FriendsList>(friendsPath, directApi.friends);
}

export function reloadFriends() {
  return refreshSpaceResource(friendsPath, directApi.friends);
}

export function useMutualFriends(userId: string) {
  return useSpaceResource<Person[]>(`/people/${encodeURIComponent(userId)}/mutual-friends`, () =>
    directApi.mutualFriends(userId),
  );
}

export function useSharedSpaces(userId: string) {
  return useSpaceResource<SharedSpace[]>(`/people/${encodeURIComponent(userId)}/shared-spaces`, () =>
    directApi.sharedSpaces(userId),
  );
}

export function useDms() {
  return useSpaceResource<DirectConversation[]>(dmsPath, directApi.dms);
}

export function reloadDms() {
  return refreshSpaceResource(dmsPath, directApi.dms);
}

export function updateDms(next: (current: DirectConversation[]) => DirectConversation[]) {
  setSpaceResource<DirectConversation[]>(dmsPath, (previous) => next(previous ?? []));
}

export function peekDm(dmId: string): DirectConversation | undefined {
  return peekSpaceResource<DirectConversation[]>(dmsPath)?.find((dm) => dm.id === dmId);
}

export function isDmId(spaceId: string): boolean {
  return Boolean(peekDm(spaceId));
}

provideDirectSpaceCheck(isDmId);

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
    const onRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          caughtUp?: boolean;
          event?: { payload?: Record<string, unknown> };
        }>
      ).detail;
      const spaceId = detail?.spaceId;
      if (!spaceId || detail.conversationId || !isDmId(spaceId)) return;
      if (detail.event?.payload?.thread_root_id) return;
      if (!detail.caughtUp) return soon();
      updateDms((current) =>
        current.some((dm) => dm.id === spaceId && dm.unread_count)
          ? current.map((dm) => (dm.id === spaceId ? { ...dm, unread_count: 0 } : dm))
          : current,
      );
    };
    window.addEventListener("misty:direct-event", soon);
    window.addEventListener("misty:space-message-event", onMessage);
    window.addEventListener("misty:space-read-event", onRead);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("misty:direct-event", soon);
      window.removeEventListener("misty:space-message-event", onMessage);
      window.removeEventListener("misty:space-read-event", onRead);
    };
  }, []);
}

export function dmOthers(dm: DirectConversation, myUserId: string | undefined) {
  return dm.members.filter((member) => member.user_id !== myUserId);
}

export function dmName(dm: DirectConversation, myUserId: string | undefined): string {
  const others = dmOthers(dm, myUserId);
  if (!others.length) return "Just you";
  return others.map((member) => member.username).join(", ");
}

export const dmPath = (dmId: string) => `/dms/${encodeURIComponent(dmId)}`;
export const friendsRoute = "/friends";
