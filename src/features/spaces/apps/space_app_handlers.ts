import { notify } from "@misty/ui";
import { useAccountPresence } from "@/shared/lib/account_presence";
import { avatarTone } from "@/shared/lib/avatar_palette";
import { requestOpenRoute } from "@/shared/lib/open_route";
import { SpaceRequestError, spacesApi } from "../api/api";
import type { MessageSpan } from "../api/dto/common";
import { appAgents, onAppAgents } from "./app_agents";
import type { HostHandlers } from "./host_channel";
import { HostError, PROTOCOL_VERSIONS } from "./protocol";
import type { ErrorCode } from "./protocol";
import { createDriveFileCalls } from "../drive/drive_app_files";
import type { FileHost } from "./space_app_files";
import { createSpaceRooms, ROOM_TOPICS } from "./space_rooms";
import { createAppCalls } from "./app_calls";
import { appRoute } from "./app_routes";
import { watchAgentControl } from "./app_screen";
import { useSpacesStore } from "../list/use_spaces_store";
import { memberAgentsIn, useMemberAgents } from "../list/member_agents";
import { useSpaceRolesStore } from "../roles/use_space_roles";

export interface Source<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface AppHostContext {
  appId: string;
  appName?: string;
  instance?: string;
  space: { id: string; name: string; description?: string; isMod: boolean };
  me: { user_id: string; name: string; role: "owner" | "member"; avatar_version?: number };
  permissions: string[];
  theme: Source<unknown>;
  route: Source<{ path: string; params: Record<string, string> }>;
  navigate(route: { path: string; params: Record<string, string> }, replace: boolean): void;
  files: Pick<FileHost, "pickFiles" | "saved">;
}

export const HOST_TOPICS = [
  "theme",
  "route",
  "files.watch",
  "members.presence",
  "calls.channels",
  "calls.current",
  "room",
  "agents.control",
] as const;

const MAX_MENTIONABLES = 20;

function spacePresence(spaceId: string, me: string) {
  const { membersBySpace, presenceBySpace } = useSpacesStore.getState();
  const viewers = new Map(
    (presenceBySpace[spaceId] ?? []).map((viewer) => [viewer.user_id, viewer]),
  );
  const accounts = useAccountPresence.getState().byUser;
  const working = new Set(
    memberAgentsIn(useMemberAgents.getState(), spaceId)
      .filter(({ agent }) => agent.state === "working")
      .map(({ userId }) => userId),
  );
  return (membersBySpace[spaceId] ?? []).map((member) => {
    const viewer = viewers.get(member.user_id);
    const status = accounts[member.user_id] ?? (member.user_id === me ? "online" : "offline");
    const shown = status !== "offline";
    return {
      user_id: member.user_id,
      state: shown ? ("online" as const) : ("offline" as const),
      status,
      working: working.has(member.user_id),
      ...(shown && viewer?.place === "app" && viewer.item_id ? { app_id: viewer.item_id } : {}),
    };
  });
}

function watchPresence(spaceId: string, me: string, emit: (data: unknown) => void): () => void {
  let last = "";
  const send = () => {
    const presence = spacePresence(spaceId, me);
    const key = JSON.stringify(presence);
    if (key === last) return;
    last = key;
    emit(presence);
  };
  send();
  const stopSpaces = useSpacesStore.subscribe((state, previous) => {
    if (
      state.presenceBySpace[spaceId] !== previous.presenceBySpace[spaceId] ||
      state.membersBySpace[spaceId] !== previous.membersBySpace[spaceId]
    )
      send();
  });
  const stopAgents = useMemberAgents.subscribe((state, previous) => {
    if (state.bySpace[spaceId] !== previous.bySpace[spaceId]) send();
  });
  const stopAccounts = useAccountPresence.subscribe((state, previous) => {
    if (state.byUser !== previous.byUser) send();
  });
  return () => {
    stopSpaces();
    stopAgents();
    stopAccounts();
  };
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "")
    throw new HostError("invalid", `${what} is missing.`);
  return value;
}

function mapped(error: unknown): never {
  if (error instanceof HostError) throw error;
  if (error instanceof SpaceRequestError) {
    const code: Record<number, ErrorCode> = {
      400: "invalid",
      403: "permission_denied",
      404: "not_found",
      409: "conflict",
    };
    throw new HostError(code[error.status] ?? "internal", error.message);
  }
  throw error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return mapped(error);
  }
}

const unsupported = (what: string) =>
  new HostError("unsupported", `${what} isn't available to apps in this version of Misty.`);

type ChatPlace =
  { kind: "channel"; spaceId: string; channelId: string } | { kind: "dm"; spaceId: string };

function appLink(spaceId: string, appId: string, route: unknown, fileId?: unknown): string {
  const next = record(route);
  const params = new URLSearchParams();
  const file = typeof fileId === "string" && fileId ? fileId : record(next.params).file;
  if (typeof file === "string" && file) params.set("file", file);
  const query = params.toString();
  return query ? `${appRoute(spaceId, appId)}?${query}` : appRoute(spaceId, appId);
}

export function createSpaceAppHandlers(context: AppHostContext): HostHandlers {
  const spaceId = context.space.id;
  const { appId } = context;
  const appName = context.appName || appId;
  const driveFiles = createDriveFileCalls(spaceId, appName, appId, context.files);
  const identity = {
    user_id: context.me.user_id,
    name: context.me.name,
    tone: context.me.user_id ? avatarTone(context.me.user_id) : null,
  };
  const instance = context.instance ?? "";
  const rooms = createSpaceRooms(spaceId, appId, {
    identity,
    holds: driveFiles,
    agents: () => (instance ? appAgents(instance) : []),
  });
  const stopAgents = instance ? onAppAgents(instance, () => rooms.agentsChanged()) : () => {};
  const appCalls = createAppCalls(spaceId);

  const members = async () => (await spacesApi.members(spaceId)).members;

  const roles = async () => {
    const known = useSpaceRolesStore.getState().bySpace[spaceId];
    if (known) return known;
    await useSpaceRolesStore.getState().load(spaceId);
    return useSpaceRolesStore.getState().bySpace[spaceId] ?? [];
  };

  const placeOf = async (target: unknown): Promise<ChatPlace> => {
    const wanted = record(target);
    if (typeof wanted.dm === "string" && wanted.dm) {
      if (wanted.dm === context.me.user_id)
        throw new HostError("invalid", "A direct message needs someone else.");
      if (!(await members()).some((member) => member.user_id === wanted.dm))
        throw new HostError("invalid", "That person isn't in this Space.");
      const dm = await spacesApi.openDirectMessage(wanted.dm);
      return { kind: "dm", spaceId: dm.id };
    }
    const channel = text(wanted.channel, "The channel").replace(/^#/, "");
    const { conversations } = await spacesApi.conversations(spaceId);
    const chats = conversations.filter((conversation) => !conversation.voice);
    const found =
      chats.find((conversation) => conversation.id === channel) ??
      chats.find((conversation) => conversation.title.toLowerCase() === channel.toLowerCase());
    if (!found) throw new HostError("not_found", "There is no such channel in this Space.");
    return { kind: "channel", spaceId, channelId: found.id };
  };

  const spansOf = async (input: unknown, card: unknown): Promise<MessageSpan[]> => {
    if (!Array.isArray(input)) throw new HostError("invalid", "The message is missing.");
    const people = input.some((span) => record(record(span).mention).kind === "member")
      ? await members()
      : [];
    const groups = input.some((span) => record(record(span).mention).kind === "role")
      ? await roles()
      : [];
    const spans: MessageSpan[] = [];
    for (const raw of input) {
      const span = record(raw);
      if (span.kind === "text") {
        if (typeof span.text === "string" && span.text)
          spans.push({ type: "text", text: span.text });
      } else if (span.kind === "mention") {
        const mention = record(span.mention);
        if (mention.kind === "member") {
          const person = people.find((member) => member.user_id === mention.id);
          if (!person) throw new HostError("invalid", "That person isn't in this Space.");
          spans.push({ type: "mention", user_id: person.user_id, label: person.name });
        } else if (mention.kind === "role") {
          const role = groups.find((group) => group.id === mention.id && group.mentionable);
          if (!role) throw new HostError("invalid", "That role can't be mentioned.");
          spans.push({ type: "mention", role_id: role.id, label: role.name });
        } else throw new HostError("invalid", "That mention isn't a person or a role.");
      } else if (span.kind === "link") {
        const url = text(span.url, "The link");
        const label = typeof span.text === "string" && span.text ? span.text : url;
        if (url.startsWith("/spaces/")) spans.push({ type: "link", label, url });
        else spans.push({ type: "text", text: label === url ? url : `${label} (${url})` });
      } else throw new HostError("invalid", "A message is made of text, mention and link spans.");
    }
    if (card !== undefined && card !== null) {
      const details = record(card);
      const title = text(details.title, "The card's title");
      if (spans.length) spans.push({ type: "text", text: "\n" });
      spans.push({
        type: "link",
        label: title,
        url: appLink(spaceId, appId, details.route, details.file_id),
      });
      if (typeof details.detail === "string" && details.detail)
        spans.push({ type: "text", text: `\n${details.detail}` });
    }
    if (!spans.length) throw new HostError("invalid", "The message is empty.");
    return spans;
  };

  const calls: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    hello: async ({ protocol }) => {
      if (typeof protocol === "number" && !PROTOCOL_VERSIONS.includes(protocol))
        throw new HostError(
          "unsupported",
          `This Misty speaks protocol ${PROTOCOL_VERSIONS.join(", ")}, not ${protocol}.`,
        );
      return {
        app_id: appId,
        space: {
          id: spaceId,
          name: context.space.name,
          description: context.space.description,
          is_mod: context.space.isMod,
        },
        me: { ...context.me, ...(identity.tone ? { tone: identity.tone } : {}) },
        theme: context.theme.get(),
        route: context.route.get(),
        permissions: context.permissions,
        protocol: typeof protocol === "number" ? protocol : PROTOCOL_VERSIONS[0],
        versions: [...PROTOCOL_VERSIONS],
        offers: {
          calls: Object.keys(calls),
          topics: [...new Set([...HOST_TOPICS, ...ROOM_TOPICS])],
        },
      };
    },
    "route.navigate": async ({ route, replace }) => {
      const next = record(route);
      context.navigate(
        {
          path: text(next.path, "The route"),
          params: record(next.params) as Record<string, string>,
        },
        replace === true,
      );
    },
    ...driveFiles.calls,
    "members.list": async () =>
      (await members()).map((member) => ({
        user_id: member.user_id,
        name: member.name,
        role: member.role,
        avatar_version: member.avatar_version,
        joined_at: member.joined_at,
        tone: avatarTone(member.user_id),
      })),
    "members.mentionables": async ({ query }) => {
      const typed = (typeof query === "string" ? query : "").trim().replace(/^@/, "").toLowerCase();
      const [people, groups] = await Promise.all([members(), roles()]);
      const matches = (name: string) => !typed || name.toLowerCase().includes(typed);
      const found = [
        ...people
          .filter((member) => matches(member.name))
          .map((member) => ({ kind: "member" as const, id: member.user_id, name: member.name })),
        ...groups
          .filter((role) => role.mentionable && matches(role.name))
          .map((role) => ({ kind: "role" as const, id: role.id, name: role.name })),
      ];
      return found.slice(0, MAX_MENTIONABLES);
    },
    "chat.post": async ({ target, spans, card }) => {
      const place = await placeOf(target);
      const content = await spansOf(spans, card);
      const { message } =
        place.kind === "channel"
          ? await spacesApi.sendConversationMessage(place.spaceId, place.channelId, content)
          : await spacesApi.sendMessage(place.spaceId, content);
      return { message_id: message.id };
    },
    "chat.open": async (target) => {
      const place = await placeOf(target);
      requestOpenRoute(
        place.kind === "channel"
          ? `/spaces/${encodeURIComponent(place.spaceId)}/chat?conversation=${encodeURIComponent(place.channelId)}`
          : `/dms/${encodeURIComponent(place.spaceId)}`,
      );
    },
    "chat.notify": async ({ user_id: userId, text: words, route }) => {
      const person = text(userId, "The person");
      const said = text(typeof words === "string" ? words.trim() : words, "The notification");
      if (person === context.me.user_id) {
        notify({ message: said });
        return;
      }
      if (!(await members()).some((member) => member.user_id === person))
        throw new HostError("invalid", "That person isn't in this Space.");
      const dm = await spacesApi.openDirectMessage(person);
      await spacesApi.sendMessage(dm.id, [
        { type: "text", text: `${said}\n` },
        { type: "link", label: appName, url: appLink(spaceId, appId, route) },
      ]);
    },
    ...rooms.calls,
    ...appCalls.calls,
  };

  return {
    async call(method, params) {
      const handler = calls[method];
      if (!handler) throw unsupported(method);
      return guarded(() => handler(record(params)));
    },
    subscribe(topic, params, emit, end) {
      switch (topic) {
        case "theme":
          emit(context.theme.get());
          return context.theme.subscribe(emit);
        case "route":
          emit(context.route.get());
          return context.route.subscribe(emit);
        case "files.watch":
          return driveFiles.watch(params, emit);
        case "members.presence":
          return watchPresence(spaceId, context.me.user_id, emit);
        case "calls.channels":
          return appCalls.watchChannels(emit);
        case "calls.current":
          return appCalls.watchCurrent(emit);
        case "agents.control":
          return watchAgentControl(context.instance ?? "", context.me.user_id, emit);
        case "room":
        case "room.frames":
          return rooms.subscribe(topic, record(params), emit, end);
        default:
          throw unsupported(topic);
      }
    },
    dispose() {
      stopAgents();
      driveFiles.dispose();
    },
  };
}
