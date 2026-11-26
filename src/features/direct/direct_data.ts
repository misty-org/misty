import { useEffect } from "react";
import { useUserStore } from "@/features/account";
import {
  onRealtimeMessage,
  peekSpaceResource,
  provideDirectSpaceCheck,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
  useSpacesStore,
} from "@/features/spaces";
import {
  directApi,
  type DirectConversation,
  type FriendsList,
  type Person,
  type SharedSpace,
} from "./api";
import { readAvatarDecoration, type AvatarDecoration } from "@/shared/lib/avatar_decoration";

const friendsPath = "/friends";
const dmsPath = "/dms";

export function useFriends() {
  return useSpaceResource<FriendsList>(friendsPath, directApi.friends);
}

export function reloadFriends() {
  return refreshSpaceResource(friendsPath, directApi.friends);
}

const peopleSeen = new Set<string>();

const mutualFriendsPath = (userId: string) =>
  `/people/${encodeURIComponent(userId)}/mutual-friends`;
const sharedSpacesPath = (userId: string) => `/people/${encodeURIComponent(userId)}/shared-spaces`;

export function useMutualFriends(userId: string) {
  peopleSeen.add(userId);
  return useSpaceResource<Person[]>(mutualFriendsPath(userId), () =>
    directApi.mutualFriends(userId),
  );
}

export function useSharedSpaces(userId: string) {
  peopleSeen.add(userId);
  return useSpaceResource<SharedSpace[]>(sharedSpacesPath(userId), () =>
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

type ProfilePatch = { avatar_version?: number; avatar_decoration?: AvatarDecoration };

function profilePatch(source: Record<string, unknown> | undefined): ProfilePatch | null {
  if (!source) return null;
  const patch: ProfilePatch = {};
  if (typeof source.avatar_version === "number") patch.avatar_version = source.avatar_version;
  if ("avatar_decoration" in source)
    patch.avatar_decoration = readAvatarDecoration(source.avatar_decoration);
  return Object.keys(patch).length ? patch : null;
}

function withProfile<T extends { user_id: string }>(
  people: T[],
  userId: string,
  patch: ProfilePatch,
): T[] {
  if (!people.some((person) => person.user_id === userId)) return people;
  return people.map((person) => (person.user_id === userId ? { ...person, ...patch } : person));
}

function applyPersonProfile(userId: string, patch: ProfilePatch) {
  const dms = peekSpaceResource<DirectConversation[]>(dmsPath);
  if (dms?.some((dm) => dm.members.some((member) => member.user_id === userId)))
    updateDms((current) =>
      current.map((dm) => {
        const members = withProfile(dm.members, userId, patch);
        return members === dm.members ? dm : { ...dm, members };
      }),
    );
  const friends = peekSpaceResource<FriendsList>(friendsPath);
  if (friends)
    setSpaceResource<FriendsList>(friendsPath, (previous = friends) => ({
      friends: withProfile(previous.friends, userId, patch),
      incoming: withProfile(previous.incoming, userId, patch),
      outgoing: withProfile(previous.outgoing, userId, patch),
      blocked: withProfile(previous.blocked, userId, patch),
    }));
  for (const person of peopleSeen) {
    const mutual = peekSpaceResource<Person[]>(mutualFriendsPath(person));
    if (mutual?.some((friend) => friend.user_id === userId))
      setSpaceResource<Person[]>(mutualFriendsPath(person), (previous = mutual) =>
        withProfile(previous, userId, patch),
      );
  }
  useSpacesStore.setState((state) => {
    let changed = false;
    const membersBySpace = Object.fromEntries(
      Object.entries(state.membersBySpace).map(([spaceId, members]) => {
        const next = withProfile(members, userId, patch);
        if (next !== members) changed = true;
        return [spaceId, next];
      }),
    );
    return changed ? { membersBySpace } : state;
  });
  if (useUserStore.getState().me?.id === userId) useUserStore.getState().patchMe(patch);
}

function applySpaceProfile(spaceId: string, patch: ProfilePatch) {
  for (const person of peopleSeen) {
    const shared = peekSpaceResource<SharedSpace[]>(sharedSpacesPath(person));
    if (shared?.some((space) => space.id === spaceId))
      setSpaceResource<SharedSpace[]>(sharedSpacesPath(person), (previous = shared) =>
        previous.map((space) => (space.id === spaceId ? { ...space, ...patch } : space)),
      );
  }
}

export function useProfileUpdates(accountId: string | undefined) {
  useEffect(() => {
    if (!accountId) return;
    const stopProfile = onRealtimeMessage("profile", (message) => {
      const profile = message.profile as Record<string, unknown> | undefined;
      const userId = profile?.user_id;
      const patch = profilePatch(profile);
      if (typeof userId === "string" && userId && patch) applyPersonProfile(userId, patch);
    });
    const onPerson = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; avatar_decoration?: unknown }>)
        .detail;
      if (!detail?.userId) return;
      applyPersonProfile(detail.userId, {
        avatar_decoration: readAvatarDecoration(detail.avatar_decoration),
      });
    };
    const onSpace = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string } & Record<string, unknown>>).detail;
      const patch = profilePatch(detail);
      if (detail?.spaceId && patch) applySpaceProfile(detail.spaceId, patch);
    };
    window.addEventListener("misty:avatar-decoration", onPerson);
    window.addEventListener("misty:space-profile", onSpace);
    return () => {
      stopProfile();
      window.removeEventListener("misty:avatar-decoration", onPerson);
      window.removeEventListener("misty:space-profile", onSpace);
    };
  }, [accountId]);
}

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
