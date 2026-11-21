import { SpaceRequestError, spacesApi } from "../api/api";
import type { HostHandlers } from "./hostChannel";
import { HostError } from "./protocol";
import type { ErrorCode } from "./protocol";
import { createDriveFileCalls } from "../drive/driveAppFiles";
import type { FileHost } from "./spaceAppFiles";
import { createAppRooms, type RoomSource } from "./appRooms";
import { createAppCalls } from "./appCalls";
import { useSpacesStore } from "../list/useSpacesStore";
import { memberAgentsIn, useMemberAgents } from "../list/memberAgents";

/** A value that changes, which an app can follow. */
export interface Source<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface AppHostContext {
  appId: string;
  /** The app's name: its own folder in the Space's drive is `/<App name>/`. Its id when left out. */
  appName?: string;
  space: { id: string; name: string; description?: string; isMod: boolean };
  me: { user_id: string; name: string; role: "owner" | "member"; avatar_version?: number };
  /** What the mod approved for this app. */
  permissions: string[];
  theme: Source<unknown>;
  route: Source<{ path: string; params: Record<string, string> }>;
  navigate(route: { path: string; params: Record<string, string> }, replace: boolean): void;
  /** What the file calls need of the person: a picker, and word that something was saved. */
  files: Pick<FileHost, "pickFiles" | "saved">;
  /** The server rooms behind the app's room ids; an installed app's own rooms when left out. */
  rooms?: RoomSource;
}

/** Each member's presence in the Space, as the SDK gives it: online while they have Misty open on it. */
function spacePresence(spaceId: string, me: string) {
  const { membersBySpace, presenceBySpace } = useSpacesStore.getState();
  const here = new Set((presenceBySpace[spaceId] ?? []).map((viewer) => viewer.user_id));
  here.add(me);
  const working = new Set(
    memberAgentsIn(useMemberAgents.getState(), spaceId)
      .filter(({ agent }) => agent.state === "working")
      .map(({ userId }) => userId),
  );
  return (membersBySpace[spaceId] ?? []).map((member) => ({
    user_id: member.user_id,
    state: here.has(member.user_id) ? ("online" as const) : ("offline" as const),
    working: working.has(member.user_id),
  }));
}

/** Calls back with the Space's presence now and whenever who is here, or whose agents work, changes. */
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
  return () => {
    stopSpaces();
    stopAgents();
  };
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "")
    throw new HostError("invalid", `${what} is missing.`);
  return value;
}

/** Answers what the server said as the code an app can act on. */
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

/** What the host does for an app's SDK calls, in this Space and as this person. */
export function createSpaceAppHandlers(context: AppHostContext): HostHandlers {
  const spaceId = context.space.id;
  const { appId } = context;
  // Its files are the Space drive's, saved into `/<App name>/` unless it names another folder.
  const driveFiles = createDriveFileCalls(spaceId, context.appName || appId, appId, context.files);
  // Its live documents (the SDK's `room()`), on the Space's live relay.
  const rooms = createAppRooms(spaceId, appId, context.rooms);
  // The Space's voice channels and this window's call, which the app may read and steer.
  const appCalls = createAppCalls(spaceId);

  const calls: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    hello: async () => ({
      app_id: appId,
      space: {
        id: spaceId,
        name: context.space.name,
        description: context.space.description,
        is_mod: context.space.isMod,
      },
      me: context.me,
      theme: context.theme.get(),
      route: context.route.get(),
      permissions: context.permissions,
    }),
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
    "members.list": async () => {
      const { members } = await spacesApi.members(spaceId);
      return members.map((member) => ({
        user_id: member.user_id,
        name: member.name,
        role: member.role,
        avatar_version: member.avatar_version,
        joined_at: member.joined_at,
      }));
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
        case "room":
          return rooms.subscribe(record(params), emit, end);
        default:
          throw unsupported(topic);
      }
    },
    dispose() {
      driveFiles.dispose();
    },
  };
}
