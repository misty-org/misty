import { SpaceRequestError, spacesApi } from "../api/api";
import { plannerApi } from "../planner/api";
import type { SpaceCalendarEventInput, SpaceTaskInput } from "../planner/api";
import { subscribeToPlannerChanges } from "../planner/plannerEvents";
import type { HostHandlers } from "./hostChannel";
import { HostError } from "./protocol";
import type { ErrorCode } from "./protocol";
import { spaceAppsApi } from "./serverApps";
import { createFileCalls, type FileHost } from "./spaceAppFiles";

/** A value that changes, which an app can follow. */
export interface Source<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface AppHostContext {
  appId: string;
  space: { id: string; name: string; description?: string; isMod: boolean };
  me: { user_id: string; name: string; role: "owner" | "member"; avatar_version?: number };
  /** What the mod approved for this app. */
  permissions: string[];
  theme: Source<unknown>;
  route: Source<{ path: string; params: Record<string, string> }>;
  navigate(route: { path: string; params: Record<string, string> }, replace: boolean): void;
  /** What the file calls need of the person: a picker, and word that something was saved. */
  files: Pick<FileHost, "pickFiles" | "saved">;
}

const calendarWindowMs = 180 * 24 * 60 * 60 * 1000;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "")
    throw new HostError("invalid", `${what} is missing.`);
  return value;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new HostError("invalid", "The version is missing.");
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
    ...createFileCalls(spaceId, {
      openRoute: (path) => context.navigate({ path, params: {} }, false),
      ...context.files,
    }),
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
    "tasks.list": async () => (await plannerApi.tasks(spaceId)).tasks,
    "tasks.create": async (params) =>
      plannerApi.createTask(spaceId, {
        ...params,
        title: text(params.title, "The title"),
      } as SpaceTaskInput & {
        title: string;
      }),
    "tasks.update": async ({ id, version: against, patch }) =>
      plannerApi.updateTask(spaceId, text(id, "The task"), {
        ...record(patch),
        version: version(against),
      } as SpaceTaskInput & { version: number }),
    "tasks.remove": async ({ id }) => {
      await plannerApi.archiveTask(spaceId, text(id, "The task"));
    },
    "events.list": async (params) => {
      const [from, to] = eventRange(params);
      return (await plannerApi.events(spaceId, from, to)).events;
    },
    "events.create": async (params) =>
      plannerApi.createEvent(spaceId, params as SpaceCalendarEventInput),
    "events.update": async ({ id, version: against, event }) =>
      plannerApi.updateEvent(spaceId, text(id, "The event"), {
        ...(record(event) as SpaceCalendarEventInput),
        version: version(against),
      }),
    "events.remove": async ({ id }) => {
      await plannerApi.deleteEvent(spaceId, text(id, "The event"));
    },
    "store.get": async ({ key }) => {
      try {
        return (await spaceAppsApi.storage.get(spaceId, appId, text(key, "The key"))).value;
      } catch (error) {
        if (error instanceof SpaceRequestError && error.status === 404) return undefined;
        throw error;
      }
    },
    "store.set": async ({ key, value }) => {
      await spaceAppsApi.storage.set(spaceId, appId, text(key, "The key"), value);
    },
    "store.list": async ({ prefix }) =>
      (
        await spaceAppsApi.storage.list(spaceId, appId, typeof prefix === "string" ? prefix : "")
      ).map(({ key, value }) => ({ key, value })),
    "store.remove": async ({ key }) => {
      await spaceAppsApi.storage.remove(spaceId, appId, text(key, "The key"));
    },
  };

  /** Sends the value now and again whenever `watch` says it changed. */
  const live = (
    load: () => Promise<unknown>,
    watch: (reload: () => void) => () => void,
    emit: (data: unknown) => void,
  ) => {
    let stopped = false;
    let running = false;
    let again = false;
    const reload = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const data = await load();
          if (!stopped) emit(data);
        } catch {
          // A failed refresh leaves the last list in place; the next change tries again.
        }
      } while (again && !stopped);
      running = false;
    };
    const unwatch = watch(() => void reload());
    void reload();
    return () => {
      stopped = true;
      unwatch();
    };
  };

  return {
    async call(method, params) {
      const handler = calls[method];
      if (!handler) throw unsupported(method);
      return guarded(() => handler(record(params)));
    },
    subscribe(topic, params, emit) {
      switch (topic) {
        case "theme":
          emit(context.theme.get());
          return context.theme.subscribe(emit);
        case "route":
          emit(context.route.get());
          return context.route.subscribe(emit);
        case "tasks":
          return live(
            () => plannerApi.tasks(spaceId).then((result) => result.tasks),
            (reload) => subscribeToPlannerChanges(spaceId, "task", reload),
            emit,
          );
        case "events": {
          const [from, to] = eventRange(record(params));
          return live(
            () => plannerApi.events(spaceId, from, to).then((result) => result.events),
            (reload) => subscribeToPlannerChanges(spaceId, "calendar", reload),
            emit,
          );
        }
        default:
          throw unsupported(topic);
      }
    },
  };
}

/** The range an app asked for, or six months either side of now. */
function eventRange(params: Record<string, unknown>): [string, string] {
  const now = Date.now();
  const from =
    typeof params.from === "string" ? params.from : new Date(now - calendarWindowMs).toISOString();
  const to =
    typeof params.to === "string" ? params.to : new Date(now + calendarWindowMs).toISOString();
  return [from, to];
}
