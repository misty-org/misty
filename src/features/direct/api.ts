import { fetchProtectedBlob, spaceRequest } from "@/features/spaces";
import type { AvatarDecoration } from "@/shared/lib/avatar_decoration";

export interface Person {
  user_id: string;
  username: string;
  avatar_version: number;
  avatar_decoration?: AvatarDecoration;
  banner_version?: number;
  since: string;
}

export interface SharedSpace {
  id: string;
  name: string;
  avatar_version: number;
  avatar_decoration?: AvatarDecoration;
}

export interface FriendsList {
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  blocked: Person[];
}

export interface DirectConversation {
  id: string;
  kind: "direct" | "group";
  members: Person[];
  unread_count: number;
  last_message_at?: string;
  read_only: boolean;
  created_at: string;
  updated_at: string;
}

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

export interface AccountStatus {
  user_id: string;
  status: PresenceStatus;
  custom_text?: string;
  custom_emoji?: string;
  custom_expires_at?: string | null;
}

export interface ChosenStatus {
  chosen: "online" | "dnd" | "invisible";
  custom_text?: string;
  custom_emoji?: string;
  custom_expires_at?: string | null;
}

export interface FriendPrivacy {
  friend_requests: "everyone" | "shared_spaces";
}

export interface AccountNotice {
  id: string;
  kind: "personal_space_private";
  payload: { owner_username?: string };
  created_at: string;
}

export interface CallConfig {
  enabled: boolean;
  url?: string;
  max_people: number;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

export const directApi = {
  friends: () => spaceRequest<FriendsList>("/friends"),
  sendFriendRequest: (username: string) =>
    spaceRequest("/friends/requests", { method: "POST", ...json({ username }) }),
  clearIncomingRequests: () => spaceRequest("/friends/requests", { method: "DELETE" }),
  acceptFriendRequest: (userId: string) =>
    spaceRequest(`/friends/requests/${id(userId)}/accept`, { method: "POST" }),
  removeFriendRequest: (userId: string) =>
    spaceRequest(`/friends/requests/${id(userId)}`, { method: "DELETE" }),
  unfriend: (userId: string) => spaceRequest(`/friends/${id(userId)}`, { method: "DELETE" }),
  block: (userId: string) => spaceRequest(`/blocks/${id(userId)}`, { method: "PUT" }),
  unblock: (userId: string) => spaceRequest(`/blocks/${id(userId)}`, { method: "DELETE" }),
  personBanner: (userId: string) => fetchProtectedBlob(`/people/${id(userId)}/banner`),
  mutualFriends: (userId: string) =>
    spaceRequest<{ friends: Person[] }>(`/people/${id(userId)}/mutual-friends`).then(
      (result) => result.friends,
    ),
  sharedSpaces: (userId: string) =>
    spaceRequest<{ spaces: SharedSpace[] }>(`/people/${id(userId)}/shared-spaces`).then(
      (result) => result.spaces,
    ),
  privacy: () => spaceRequest<FriendPrivacy>("/me/privacy"),
  setPrivacy: (privacy: FriendPrivacy) =>
    spaceRequest<FriendPrivacy>("/me/privacy", { method: "PUT", ...json(privacy) }),

  dms: () => spaceRequest<{ dms: DirectConversation[] }>("/dms").then((result) => result.dms),
  dm: (dmId: string) => spaceRequest<DirectConversation>(`/dms/${id(dmId)}`),
  openDm: (userId: string) =>
    spaceRequest<DirectConversation>("/dms", { method: "POST", ...json({ user_id: userId }) }),
  createGroupDm: (userIds: string[]) =>
    spaceRequest<DirectConversation>("/dms", { method: "POST", ...json({ user_ids: userIds }) }),
  addDmMembers: (dmId: string, userIds: string[]) =>
    spaceRequest<DirectConversation>(`/dms/${id(dmId)}/members`, {
      method: "POST",
      ...json({ user_ids: userIds }),
    }),
  leaveDm: (dmId: string) => spaceRequest(`/dms/${id(dmId)}/members/me`, { method: "DELETE" }),
  deleteDm: (dmId: string) => spaceRequest(`/dms/${id(dmId)}`, { method: "DELETE" }),
  ringDm: (
    dmId: string,
    state: "ringing" | "ended" | "declined" | "answered" | "busy",
    video: boolean,
    sealedKeys: Record<string, string> = {},
    senderKeyId = "",
  ) =>
    spaceRequest(`/dms/${id(dmId)}/call`, {
      method: "POST",
      ...json({ state, video, sealed_keys: sealedKeys, sender_key_id: senderKeyId }),
    }),
  putCallKey: (keyId: string, publicKey: string) =>
    spaceRequest(`/me/call-keys/${id(keyId)}`, {
      method: "PUT",
      ...json({ public_key: publicKey }),
    }),
  dmCallKeys: (dmId: string) =>
    spaceRequest<{ keys: { user_id: string; key_id: string; public_key: string }[] }>(
      `/dms/${id(dmId)}/call-keys`,
    ).then((result) => result.keys),

  myStatus: () => spaceRequest<ChosenStatus>("/me/status"),
  setMyStatus: (status: ChosenStatus, fields: readonly string[] = []) =>
    spaceRequest<ChosenStatus>(
      fields.length ? `/me/status?fields=${encodeURIComponent(fields.join(","))}` : "/me/status",
      { method: "PUT", ...json(status) },
    ),
  statuses: () =>
    spaceRequest<{ statuses: AccountStatus[] }>("/statuses").then((result) => result.statuses),

  notices: () =>
    spaceRequest<{ notices: AccountNotice[] }>("/me/notices").then((result) => result.notices),
  markNoticeSeen: (noticeId: string) =>
    spaceRequest(`/me/notices/${id(noticeId)}/seen`, { method: "POST" }),

  callConfig: () => spaceRequest<CallConfig>("/calls/config"),
  callToken: (room: string) =>
    spaceRequest<{ token: string; url: string; room: string; people?: string[] }>(
      `/calls/${id(room)}/token`,
      {
        method: "POST",
      },
    ),
  moderateCall: (room: string, action: "mute" | "remove", person: string) =>
    spaceRequest<void>(`/calls/${id(room)}/moderate`, {
      method: "POST",
      ...json({ action, person }),
    }),
};
