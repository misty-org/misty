import { spaceRequest } from "@/features/spaces";

/** Someone in the friends list or a DM: their id, username and picture. */
export interface Person {
  user_id: string;
  username: string;
  avatar_version: number;
  /** When they became friends, sent the request, were blocked or joined the DM. */
  since: string;
}

export interface FriendsList {
  friends: Person[];
  /** Requests waiting on the person. */
  incoming: Person[];
  /** Requests the person sent. */
  outgoing: Person[];
  blocked: Person[];
}

/**
 * A DM. It is a Space of kind "direct" on the server, so `id` is that Space's id and its messages
 * are the Space's own chat: the Space chat code reads and writes them by `id`.
 */
export interface DirectConversation {
  id: string;
  /** Two people, or a group of three to ten. */
  kind: "direct" | "group";
  members: Person[];
  unread_count: number;
  last_message_at?: string;
  /** A one-to-one DM whose two people aren't friends (anymore): its history only, no composer. */
  read_only: boolean;
  created_at: string;
  updated_at: string;
}

/** How someone shows to others. Invisible shows as offline. */
export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

export interface AccountStatus {
  user_id: string;
  status: PresenceStatus;
  custom_text?: string;
  custom_emoji?: string;
}

/** What the person chose: Online and Idle are worked out from their computers. */
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
  /** Answers the same whether or not it reached anyone. */
  sendFriendRequest: (username: string) =>
    spaceRequest("/friends/requests", { method: "POST", ...json({ username }) }),
  clearIncomingRequests: () => spaceRequest("/friends/requests", { method: "DELETE" }),
  acceptFriendRequest: (userId: string) =>
    spaceRequest(`/friends/requests/${id(userId)}/accept`, { method: "POST" }),
  /** Ignores a request to the person, or cancels one they sent. The other is never told. */
  removeFriendRequest: (userId: string) =>
    spaceRequest(`/friends/requests/${id(userId)}`, { method: "DELETE" }),
  /** Also deletes the pair's one-to-one DM for both. */
  unfriend: (userId: string) => spaceRequest(`/friends/${id(userId)}`, { method: "DELETE" }),
  /** Also ends any friendship and deletes the pair's one-to-one DM for both. */
  block: (userId: string) => spaceRequest(`/blocks/${id(userId)}`, { method: "PUT" }),
  unblock: (userId: string) => spaceRequest(`/blocks/${id(userId)}`, { method: "DELETE" }),
  privacy: () => spaceRequest<FriendPrivacy>("/me/privacy"),
  setPrivacy: (privacy: FriendPrivacy) =>
    spaceRequest<FriendPrivacy>("/me/privacy", { method: "PUT", ...json(privacy) }),

  dms: () => spaceRequest<{ dms: DirectConversation[] }>("/dms").then((result) => result.dms),
  dm: (dmId: string) => spaceRequest<DirectConversation>(`/dms/${id(dmId)}`),
  /** Finds or starts the one-to-one DM with a friend. */
  openDm: (userId: string) =>
    spaceRequest<DirectConversation>("/dms", { method: "POST", ...json({ user_id: userId }) }),
  /** Starts a group DM with two to nine friends. */
  createGroupDm: (userIds: string[]) =>
    spaceRequest<DirectConversation>("/dms", { method: "POST", ...json({ user_ids: userIds }) }),
  /** Adding to a one-to-one DM starts a new group, which this returns. */
  addDmMembers: (dmId: string, userIds: string[]) =>
    spaceRequest<DirectConversation>(`/dms/${id(dmId)}/members`, {
      method: "POST",
      ...json({ user_ids: userIds }),
    }),
  leaveDm: (dmId: string) => spaceRequest(`/dms/${id(dmId)}/members/me`, { method: "DELETE" }),
  /** Deletes a one-to-one DM for both people. */
  deleteDm: (dmId: string) => spaceRequest(`/dms/${id(dmId)}`, { method: "DELETE" }),
  ringDm: (dmId: string, state: "ringing" | "ended", video: boolean) =>
    spaceRequest(`/dms/${id(dmId)}/call`, { method: "POST", ...json({ state, video }) }),

  myStatus: () => spaceRequest<ChosenStatus>("/me/status"),
  setMyStatus: (status: ChosenStatus) =>
    spaceRequest<ChosenStatus>("/me/status", { method: "PUT", ...json(status) }),
  statuses: () =>
    spaceRequest<{ statuses: AccountStatus[] }>("/statuses").then((result) => result.statuses),

  notices: () =>
    spaceRequest<{ notices: AccountNotice[] }>("/me/notices").then((result) => result.notices),
  markNoticeSeen: (noticeId: string) =>
    spaceRequest(`/me/notices/${id(noticeId)}/seen`, { method: "POST" }),

  callConfig: () => spaceRequest<CallConfig>("/calls/config"),
  callToken: (room: string) =>
    spaceRequest<{ token: string; url: string; room: string }>(`/calls/${id(room)}/token`, {
      method: "POST",
    }),
};
