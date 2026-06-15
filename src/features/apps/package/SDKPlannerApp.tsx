import "@/styles/styles.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PointerDragProvider } from "@/features/dnd/PointerDragContext";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import {
  defineComponentApp,
  type MistyAppSDK,
  type MistyComponentContext,
  type MistyAppSettings,
  type MistySurfaceAdapter,
  type MistyAppCommand,
  type MistyDataDomain,
  type Space,
} from "@misty/sdk";
import { SpaceTasksView } from "@/features/spaces/planner/SpaceTasksView";
import { SpaceAgendaView } from "@/features/spaces/planner/SpaceAgendaView";
import { SpaceRoadmapView } from "@/features/spaces/roadmap/SpaceRoadmapView";
import { createSDKTaskServices } from "@/features/spaces/planner/spaceTasks/taskServices";
import {
  createSDKCalendarServices,
  createSDKConnectionServices,
} from "@/features/spaces/planner/spaceAgenda/calendarServices";
import { createSDKRoadmapServices } from "@/features/spaces/roadmap/spaceRoadmap/roadmapServices";
import {
  RoadmapRuntimeProvider,
  type PlannerPreferenceStorage,
} from "@/features/spaces/roadmap/spaceRoadmap/roadmapRuntime";
import type { SpaceAgendaVisibility } from "@/features/spaces/store/useSpaceAgendaPreferences";
import type { SpaceMember, SpaceAgentMembership } from "@/api/spaces/dto/interfaces/agentTaskTypes";
import { plannerMember, plannerAgent } from "./plannerMembers";
import { hostAppRoute, packageRoute } from "./routes";

type Services = {
  misty: MistyAppSDK;
  space: Space;
  userId?: string;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  api: ReturnType<typeof createSDKTaskServices> &
    ReturnType<typeof createSDKCalendarServices> &
    ReturnType<typeof createSDKRoadmapServices>;
  connections: ReturnType<typeof createSDKConnectionServices>;
  storage: PlannerPreferenceStorage;
  report(error: unknown): void;
  subscribe(domains: readonly MistyDataDomain[], listener: () => void): () => void;
  register(command: MistyAppCommand, listener: () => void, enabled: () => boolean): () => void;
};

function Integration({
  services,
  title,
  adapter,
  onCreate,
  canCreate = false,
}: {
  services: Services;
  title: string;
  adapter: MistySurfaceAdapter | null;
  onCreate?: () => void;
  canCreate?: boolean;
}) {
  useEffect(() => {
    void services.misty.workspace
      .setTitle(title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "Planner")
      .catch(services.report);
  }, [services, title]);
  useEffect(() => {
    if (!adapter) return;
    let closed = false;
    let remove: (() => void) | undefined;
    void services.misty.surfaces
      .register(adapter)
      .then((cleanup) => {
        if (closed) cleanup();
        else remove = cleanup;
      })
      .catch(services.report);
    return () => {
      closed = true;
      remove?.();
    };
  }, [adapter, services]);
  useEffect(
    () => (onCreate ? services.register("planner.create", onCreate, () => canCreate) : undefined),
    [services, canCreate, onCreate],
  );
  return null;
}
function ErrorMessage({ services, message }: { services: Services; message: string }) {
  useEffect(() => services.report(message), [message, services]);
  return (
    <div
      className="m-3 rounded-lg border border-charcoal-border p-3 text-sm text-cream-muted"
      role="alert"
    >
      {message}
    </div>
  );
}
function PlannerViews({
  services,
  context,
  settings,
}: {
  services: Services;
  context: MistyComponentContext;
  settings: MistyAppSettings;
}) {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const section = parts[3] || "tasks";
  const taskChanges = useCallback(
    (listener: () => void) => services.subscribe(["tasks"], listener),
    [services],
  );
  const agendaChanges = useCallback(
    (listener: () => void) => services.subscribe(["tasks", "calendar", "roadmaps"], listener),
    [services],
  );
  const roadmapChanges = useCallback(
    (listener: () => void) => services.subscribe(["roadmaps"], listener),
    [services],
  );
  const renderIntegration = (input: {
    title: string;
    adapter: MistySurfaceAdapter | null;
    onCreate?: () => void;
    canCreate?: boolean;
  }) => <Integration services={services} {...input} />;
  const renderError = (message: string) => <ErrorMessage services={services} message={message} />;
  const canManage = services.space.permissions?.["tasks.manage"] === true;
  const shared = {
    api: services.api,
    members: services.members,
    agents: services.agents,
    renderIntegration,
    renderError,
  };
  if (section === "agenda")
    return (
      <Agenda
        services={services}
        shared={shared}
        subscribeChanges={agendaChanges}
        view={parts[4] === "day" || parts[4] === "week" ? parts[4] : "month"}
        canManage={canManage}
      />
    );
  if (["roadmaps", "goals", "milestones"].includes(section))
    return (
      <RoadmapRuntimeProvider
        runtime={{
          api: services.api,
          userId: services.userId,
          storage: services.storage,
          focused: context.focused ?? context.active,
          theme: context.appearance.mode,
          shortcutLabels: settings.shortcutLabels ?? {},
          registerCommand: services.register,
          subscribeChanges: roadmapChanges,
          renderIntegration,
          renderError,
        }}
      >
        <SpaceRoadmapView
          spaceId={services.space.id}
          roadmapId={section === "roadmaps" ? decodeURIComponent(parts[4] || "") : ""}
          canManage={canManage}
        />
      </RoadmapRuntimeProvider>
    );
  return (
    <SpaceTasksView
      spaceId={services.space.id}
      canManage={canManage}
      runtime={{ ...shared, userId: services.userId, subscribeChanges: taskChanges }}
    />
  );
}
function Agenda({
  services,
  shared,
  subscribeChanges,
  view,
  canManage,
}: {
  services: Services;
  shared: Pick<
    Parameters<typeof SpaceAgendaView>[0]["runtime"],
    "api" | "members" | "agents" | "renderIntegration" | "renderError"
  >;
  subscribeChanges(listener: () => void): () => void;
  view: "month" | "week" | "day";
  canManage: boolean;
}) {
  const key = `agenda-visibility:${services.space.id}`;
  const [visibility, setVisibility] = useState<SpaceAgendaVisibility>(() => {
    try {
      const value = JSON.parse(services.storage.getItem(key) ?? "null");
      return {
        tasks: value?.tasks !== false,
        roadmap: value?.roadmap !== false,
        hiddenSources: Array.isArray(value?.hiddenSources)
          ? value.hiddenSources.filter((id: unknown): id is string => typeof id === "string")
          : [],
      };
    } catch {
      return { tasks: true, roadmap: true, hiddenSources: [] };
    }
  });
  useEffect(() => {
    services.storage.setItem(key, JSON.stringify(visibility));
  }, [key, services, visibility]);
  return (
    <SpaceAgendaView
      spaceId={services.space.id}
      view={view}
      canManage={canManage}
      canManageIntegrations={services.space.role === "owner"}
      runtime={{
        ...shared,
        connections: services.connections,
        subscribeChanges,
        visibility,
        setVisibility,
        confirm: services.misty.dialogs.confirm,
        openAuthorization: services.misty.links.openExternal,
      }}
    />
  );
}
function PlannerLocation({
  services,
  context,
  settings,
}: {
  services: Services;
  context: MistyComponentContext;
  settings: MistyAppSettings;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const hostRoute = packageRoute("planner", services.space.id, context.route);
  const route = `${location.pathname}${location.search}${location.hash}`;
  const previousHost = useRef(hostRoute);
  const previousRoute = useRef(hostRoute);
  useLayoutEffect(() => {
    if (previousHost.current !== hostRoute) {
      previousHost.current = hostRoute;
      previousRoute.current = hostRoute;
      if (route !== hostRoute) void navigate(hostRoute, { replace: true });
    } else if (previousRoute.current !== route) {
      previousRoute.current = route;
      void services.misty.navigation
        .open(hostAppRoute("planner", services.space.id, route))
        .catch(services.report);
    }
  }, [hostRoute, navigate, route, services]);
  return <PlannerViews services={services} context={context} settings={settings} />;
}

export default defineComponentApp({
  appId: "planner",
  protocol: 2,
  async mount({ root, misty, context: initialContext, signal }) {
    let closed = false;
    let context = initialContext;
    const removers = new Set<() => void>();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    const report = (error: unknown) => {
      if (!closed && !signal?.aborted)
        void misty.activity
          .report(String(error).slice(0, 2000) || "Planner request failed")
          .catch(() => undefined);
    };
    const subscribe = (start: () => Promise<() => void>) => {
      let removed = false;
      let stop: (() => void) | undefined;
      const remove = () => {
        if (removed) return;
        removed = true;
        removers.delete(remove);
        stop?.();
      };
      removers.add(remove);
      void start()
        .then((cleanup) => {
          if (removed || closed) cleanup();
          else stop = cleanup;
        })
        .catch(report);
      return remove;
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      reactRoot?.unmount();
      removers.forEach((remove) => remove());
      removers.clear();
      signal?.removeEventListener("abort", dispose);
    };
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      const identity = await misty.context.get();
      if (!identity.space?.id) throw new Error("Open Planner in a Space.");
      const spaceID = identity.space.id;
      const [space, membership, initialSettings, keys] = await Promise.all([
        misty.server.call("spaces.get", { path: { spaceID } }),
        misty.server.call("spaces.members.list", { path: { spaceID } }),
        misty.settings.snapshot(),
        misty.storage.local.keys(),
      ]);
      const preferences = new Map<string, string>();
      for (let offset = 0; offset < keys.length; offset += 16)
        await Promise.all(
          keys.slice(offset, offset + 16).map(async (key) => {
            const value = await misty.storage.local.get(key);
            if (value != null)
              preferences.set(key, typeof value === "string" ? value : JSON.stringify(value));
          }),
        );
      if (closed || signal?.aborted) throw new Error("Planner closed while loading.");
      let settings = initialSettings;
      const pendingWrites = new Map<string, Promise<void>>();
      const services: Services = {
        misty,
        space,
        userId: identity.user?.id,
        members: (membership.members ?? []).map(plannerMember),
        agents: (membership.agents ?? []).map(plannerAgent),
        api: {
          ...createSDKTaskServices(misty),
          ...createSDKCalendarServices(misty),
          ...createSDKRoadmapServices(misty),
        },
        connections: createSDKConnectionServices(misty),
        report,
        storage: {
          getItem: (key) => preferences.get(key) ?? null,
          setItem(key, value) {
            if (closed || preferences.get(key) === value) return;
            preferences.set(key, value);
            const write = (pendingWrites.get(key) ?? Promise.resolve())
              .catch(() => undefined)
              .then(() => misty.storage.local.set(key, value));
            pendingWrites.set(key, write);
            void write.catch(report).finally(() => {
              if (pendingWrites.get(key) === write) pendingWrites.delete(key);
            });
          },
        },
        subscribe: (domains, listener) => {
          const remove = domains.map((domain) =>
            subscribe(() => misty.data.subscribe(domain, listener)),
          );
          return () => remove.forEach((cleanup) => cleanup());
        },
        register: (command, listener, enabled) =>
          subscribe(() =>
            misty.shortcuts.register(command, () => {
              if (!closed && (context.focused ?? context.active) && enabled()) listener();
            }),
          ),
      };
      const render = () => {
        if (!closed)
          reactRoot?.render(
            <MemoryRouter initialEntries={[packageRoute("planner", spaceID, initialContext.route)]}>
              <PointerDragProvider>
                <PlannerLocation services={services} context={context} settings={settings} />
              </PointerDragProvider>
            </MemoryRouter>,
          );
      };
      reactRoot = createRoot(root);
      render();
      subscribe(() =>
        misty.settings.subscribe((value) => {
          settings = value;
          render();
        }),
      );
      return {
        update(next) {
          if (!closed) {
            context = next;
            render();
          }
        },
        unmount: dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});
