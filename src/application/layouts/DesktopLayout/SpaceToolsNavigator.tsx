import { spaceToolRouteFromAppRoute } from "@/features/spaces/spaceAppRoute";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  WorkspaceAppIcon,
  type NavigatorAppId,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useId, type ComponentType } from "react";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";
import { useNavigatorOrder } from "./useNavigatorOrder";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { MessagesSquare, type LucideProps } from "lucide-react";
import {
  NotesDestinationIcon,
  DrawingsDestinationIcon,
  TasksDestinationIcon,
  AgendaDestinationIcon,
  RoadmapsDestinationIcon,
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  AlbumsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";

const tools = [
  {
    id: "social",
    label: "Chat",
    path: "social/misty",
    permission: "messages.read",
    children: [{ label: "Messages", path: "social/misty", icon: MessagesSquare }],
  },
  {
    id: "journal",
    label: "Journal",
    path: "notes",
    children: [
      { label: "Notes", path: "notes", icon: NotesDestinationIcon },
      { label: "Drawings", path: "drawings", icon: DrawingsDestinationIcon },
    ],
  },
  {
    id: "planner",
    label: "Planner",
    path: "planner/tasks/board",
    permission: "tasks.view",
    children: [
      { label: "Tasks", path: "planner/tasks/board", icon: TasksDestinationIcon },
      { label: "Agenda", path: "planner/agenda/month", icon: AgendaDestinationIcon },
      { label: "Roadmaps", path: "planner/roadmaps", icon: RoadmapsDestinationIcon },
    ],
  },
  {
    id: "library",
    label: "Library",
    path: "library",
    permission: "library.view",
    children: [
      { label: "All items", path: "library", icon: AllItemsDestinationIcon },
      { label: "Favorites", path: "library?collection=favorites", icon: FavoritesDestinationIcon },
      {
        label: "Collections",
        path: "library?collection=collections",
        icon: CollectionsDestinationIcon,
      },
      { label: "Albums", path: "library?collection=albums", icon: AlbumsDestinationIcon },
      {
        label: "Recently deleted",
        path: "library?collection=deleted",
        icon: DeletedDestinationIcon,
      },
    ],
  },
] satisfies Array<{
  id: NavigatorAppId;
  label: string;
  path: string;
  permission?: string;
  children: Array<{ label: string; path: string; icon: ComponentType<LucideProps> }>;
}>;

export function SpaceToolsNavigator(props: {
  accountId: string;
  space?: Space;
  activeRoute: string;
  loading: boolean;
  error: boolean;
}) {
  const visibleTools = tools.filter(
    (tool) => !tool.permission || props.space?.permissions?.[tool.permission] !== false,
  );
  const section = `space:${props.space?.id ?? "pending"}:sections`;
  const order = useNavigatorOrder(
    props.accountId,
    section,
    visibleTools.map((tool) => tool.id),
  );
  const drag = usePointerReorder({
    scope: `navigator:${props.accountId}:${section}`,
    axis: "y",
    hitArea: "header",
    getDrag: (id) => {
      const tool = visibleTools.find((tool) => tool.id === id);
      return tool ? { id, label: tool.label } : null;
    },
    onDrop: (item, target, after) => order.move(item.id, target, after),
    onKeyboardMove: order.step,
  });
  if (!props.space)
    return (
      <p className="px-2.5 py-2 text-xs text-cream-muted" role="status">
        {props.loading
          ? "Loading Space…"
          : props.error
            ? "Space tools are unavailable. Open Activity for details."
            : "Choose or create a Space to work together."}
      </p>
    );
  return (
    <div {...drag} className="grid gap-0.5" aria-label="Space tools" role="group">
      {order.ids
        .flatMap((id) => visibleTools.filter((tool) => tool.id === id))
        .map((tool) => (
          <div key={tool.id} data-reorder-item={tool.id}>
            <SpaceTool
              tool={tool}
              space={props.space!}
              accountId={props.accountId}
              activeRoute={props.activeRoute}
            />
          </div>
        ))}
    </div>
  );
}

function SpaceTool({
  tool,
  space,
  accountId,
  activeRoute,
}: {
  tool: (typeof tools)[number];
  space: Space;
  accountId: string;
  activeRoute: string;
}) {
  const childSection = `space:${space.id}:${tool.id}:destinations`;
  const childOrder = useNavigatorOrder(
    accountId,
    childSection,
    tool.children.map((child) => child.path),
  );
  const children = childOrder.ids.flatMap((id) =>
    tool.children.filter((child) => child.path === id),
  );
  const childDrag = usePointerReorder({
    scope: `navigator:${accountId}:${childSection}`,
    axis: "y",
    getDrag: (id) => {
      const child = children.find((child) => child.path === id);
      return child ? { id, label: child.label } : null;
    },
    onDrop: (item, target, after) => childOrder.move(item.id, target, after),
    onKeyboardMove: childOrder.step,
  });
  const navigate = useNavigate();
  const base = `/spaces/${encodeURIComponent(space.id)}/`;
  const route = base + tool.path;
  const target = workspaceSurfaceFromRoute(route);
  const active = workspaceSurfaceFromRoute(activeRoute)?.groupKey === target?.groupKey;
  const [open, setOpen] = useNavigatorDisclosureState(
    accountId,
    `item:${tool.id}:space:${space.id}`,
    active,
  );
  const contentId = useId();
  useEffect(() => {
    if (active) setOpen(true);
  }, [active, setOpen]);
  const openRoute = (path: string) => {
    const surface = workspaceSurfaceFromRoute(path);
    if (surface) navigate(useWorkspaceStore.getState().openSurface(surface).route);
  };
  const current = new URL(
    spaceToolRouteFromAppRoute(activeRoute, space.id) ?? activeRoute,
    "https://misty.local",
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={navigationMenuGroupClass}
      data-space-tool={tool.id}
    >
      <NavigationSectionButton
        icon={<WorkspaceAppIcon appId={tool.id} size="nav" context="space" />}
        label={tool.label}
        open={open}
        title="Drag to reorder · Alt+Shift+↑/↓"
        aria-label={tool.label}
        data-active={active || undefined}
        aria-controls={contentId}
        onClick={() => {
          if (active) setOpen(!open);
          else {
            setOpen(true);
            openRoute(route);
          }
        }}
      />
      <CollapsibleContent id={contentId}>
        <div
          {...childDrag}
          className={navigationMenuGroupClass}
          role="group"
          aria-label={`${tool.label} destinations`}
        >
          {children.map((child, index) => {
            const path = base + child.path;
            const url = new URL(path, "https://misty.local");
            const selected =
              active &&
              (tool.id === "library"
                ? (current.searchParams.get("collection") ?? "recent") ===
                  (url.searchParams.get("collection") ?? "recent")
                : tool.id === "planner"
                  ? current.pathname.split("/")[4] === url.pathname.split("/")[4]
                  : current.pathname === url.pathname ||
                    current.pathname.startsWith(url.pathname + "/"));
            return (
              <div key={child.path} data-reorder-item={child.path}>
                <NavigationTreeItem
                  asChild
                  icon={<child.icon aria-hidden />}
                  label={child.label}
                  selected={selected}
                  last={index === children.length - 1}
                >
                  <Link
                    data-reorder-handle="true"
                    title="Drag to reorder · Alt+Shift+↑/↓"
                    to={path}
                    onClick={(event) => {
                      event.preventDefault();
                      openRoute(path);
                    }}
                  />
                </NavigationTreeItem>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
