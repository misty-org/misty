import { addNavigatorIntegration } from "@/features/apps/addNavigatorIntegration";
import { removeNavigatorPin } from "@/features/apps/removeNavigatorPin";
import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationName, sectionNameKey, itemNameKey } from "@/features/navigation-names/store";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { useNavigatorResume } from "./useNavigatorResume";
import { useNavigatorOrder } from "./useNavigatorOrder";
import { WebsiteBrandIcon } from "../../../../../misty-apps/apps/shared/WebsiteBrandIcon";
import {
  websiteIntegrations,
  type WebsiteIntegrationId,
} from "../../../../../misty-apps/apps/shared/websiteIntegrations";
import { ProviderBrandIcon } from "../../../../../misty-apps/apps/shared/ProviderBrandIcon";
import { providers, providerFromRoute } from "../../../../../misty-apps/apps/shared/providers";
import {
  NotesDestinationIcon,
  DrawingsDestinationIcon,
  TasksDestinationIcon,
  AgendaDestinationIcon,
  RoadmapsDestinationIcon,
  ExplorerDestinationIcon,
  TransfersDestinationIcon,
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  AlbumsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
import { MailProviderIcon } from "@/shared/ui/mail-provider-icon";
import { Check, Search, Link2, PinOff, Plug } from "lucide-react";
import { BotMessageSquare, Workflow } from "lucide-react";
import type { MistyNavigationItem } from "@misty/sdk";
import { FileText } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useId, useRef, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Input,
  Collapsible,
  CollapsibleContent,
  NavigationSectionButton,
  navigationMenuRowClass,
  navigationMenuActionClass,
  NavigationTreeItem,
  navigationMenuGroupClass,
  navigationTreeContinuationClass,
} from "@/shared/ui";
import {
  WorkspaceAppIcon,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
} from "@/features/workspace";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

export function DownloadedAppNavigator(props: {
  accountId: string;
  appId: NavigatorAppId;
  label: string;
  active: boolean;
  activeRoute: string;
  items: readonly MistyNavigationItem[];
}) {
  const label = useNavigationName(sectionNameKey(props.appId), props.label);
  const contentId = useId();
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, props.appId, props.active);
  useEffect(() => {
    if (props.active) setOpen(true);
  }, [props.active, setOpen]);
  const integrations =
    ["social", "inbox", "planner", "journal", "library"].includes(props.appId) &&
    /Mac/.test(navigator.platform);
  // Drop the retired native Inbox entry even from cached package navigation.
  const destinations =
    props.appId === "inbox" ? props.items.filter((item) => item.id !== "misty") : props.items;
  const visible = integrations
    ? destinations.filter((item) => item.id !== "integrations")
    : destinations;
  // Old package registrations may include every account or page. Provider
  // subsections are shortcuts the user explicitly pinned, including pin groups.
  const items = visible.map((item) =>
    item.id !== "misty" &&
    ["social", "inbox", "planner", "journal", "library"].includes(props.appId)
      ? { ...item, children: pinnedDestinations(item.children) }
      : item,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string>();
  const [sourceError, setSourceError] = useState("");
  const addingRef = useRef(false);
  const family = props.appId === "social" ? "chat" : props.appId;
  const catalogSources: MistyNavigationItem[] = Object.entries(providers)
    .filter(([, provider]) => provider.family === family)
    .map(([id, provider]) => ({
      id,
      label: provider.label,
      route: `/apps/${props.appId}?provider=${encodeURIComponent(id)}`,
    }));
  const sources = [
    ...items,
    ...catalogSources.filter((candidate) => !items.some((item) => item.id === candidate.id)),
  ];
  const filteredSources = sources.filter((item) => {
    const description = websiteIntegrations[item.id as WebsiteIntegrationId]?.description ?? "";
    return `${item.label} ${description}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const navigate = useNavigate();
  const [selectedSourceId, setSelectedSourceId] = useState<string>();
  const activeUrl = new URL(props.activeRoute || `/apps/${props.appId}`, "https://misty.local");
  const activeProvider = activeUrl.searchParams.get("provider");
  const routeSource =
    activeUrl.pathname === `/apps/${props.appId}`
      ? sources.find(
          (item) =>
            sameRoute(item.route, props.activeRoute) ||
            hasSelectedDescendant(item.children, props.activeRoute) ||
            (activeProvider &&
              new URL(item.route, "https://misty.local").searchParams.get("provider") ===
                activeProvider),
        )
      : undefined;
  const source = routeSource ?? sources.find((item) => item.id === selectedSourceId) ?? items[0];
  const sourceDestinations =
    source?.id === "misty" ? (source.children ?? []) : pinnedDestinations(source?.children);
  const routeSourceId = routeSource?.id;
  useEffect(() => {
    if (routeSourceId) setSelectedSourceId(routeSourceId);
  }, [routeSourceId]);
  const openRoute = (destination: string) => {
    const surface = workspaceSurfaceFromRoute(destination);
    if (surface) {
      const tab = useWorkspaceStore.getState().openSurface({ ...surface, syncExistingRoute: true });
      navigate(tab.route);
    }
  };
  const route =
    props.appId === "browser"
      ? "/apps/browser"
      : props.active && props.activeRoute.startsWith(`/apps/${props.appId}`)
        ? props.activeRoute
        : (source?.route ?? `/apps/${props.appId}`);
  const resume = useNavigatorResume({
    accountId: props.accountId,
    key: props.appId,
    fallbackRoute: route,
    activeRoute: props.active ? props.activeRoute : undefined,
  });
  const activate = () => {
    if (props.active && open) setOpen(false);
    else {
      setOpen(true);
      resume();
    }
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={navigationMenuGroupClass}
      data-navigator-disclosure={props.appId}
    >
      <Renameable nameKey={sectionNameKey(props.appId)} automatic={props.label}>
        <div className={`${navigationMenuRowClass} flex items-center`} data-reorder-preview="true">
          <NavigationSectionButton
            icon={<WorkspaceAppIcon appId={props.appId} size="nav" />}
            label={label}
            open={open}
            aria-label={label}
            aria-current={
              props.appId === "browser" &&
              props.active &&
              !items.some((item) => sameRoute(item.route, props.activeRoute))
                ? "page"
                : undefined
            }
            aria-controls={contentId}
            data-navigator-disclosure-trigger="true"
            className="min-w-0 flex-1 !w-auto !bg-transparent"
            title={`${label} · Drag to reorder · Alt+Shift+↑/↓`}
            onClick={activate}
          />
          {integrations && (
            <Popover
              open={pickerOpen}
              onOpenChange={(next) => {
                setPickerOpen(next);
                if (next) {
                  setQuery("");
                  setSourceError("");
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-reorder-ignore="true"
                  data-misty-window-drag-block="true"
                  aria-label={`${label} source: ${source?.label ?? "Choose integration"}`}
                  title={`Switch ${label} source`}
                  className="mr-1 flex h-[22px] min-w-0 max-w-[112px] shrink-0 items-center gap-1 rounded-md bg-charcoal-hover px-1.5 text-[13px] font-medium text-cream outline-none hover:bg-charcoal-active focus-visible:ring-1 focus-visible:ring-cream-muted [&_svg]:!size-3.5 [&_img]:!size-3.5"
                >
                  {source ? (
                    <DestinationIcon appId={props.appId} item={source} />
                  ) : (
                    <Plug aria-hidden />
                  )}
                  <span className="truncate">{source?.label ?? "Integration"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                sideOffset={12}
                align="start"
                className="w-[300px] overflow-hidden p-0"
              >
                <div className="border-b border-charcoal-border p-2">
                  <div className="relative">
                    <Search
                      aria-hidden
                      size={14}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
                    />
                    <Input
                      autoFocus
                      aria-label={`Search ${label} integrations`}
                      placeholder="Search integrations…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                </div>
                <div
                  className="misty-transient-scrollbar max-h-[360px] overflow-y-auto p-1"
                  role="group"
                  aria-label={`${label} integrations`}
                  aria-busy={!!adding}
                >
                  {filteredSources.map((item) => {
                    const selected = source?.id === item.id;
                    const added = items.some((existing) => existing.id === item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={`${added ? "Switch to" : "Add"} ${item.label}`}
                        aria-pressed={selected}
                        disabled={!!adding}
                        className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-cream outline-none hover:bg-charcoal-hover focus-visible:bg-charcoal-hover disabled:opacity-50"
                        onClick={async () => {
                          if (addingRef.current) return;
                          addingRef.current = true;
                          setAdding(item.id);
                          setSourceError("");
                          try {
                            if (!added)
                              await addNavigatorIntegration(props.accountId, props.appId, item.id);
                            setSelectedSourceId(item.id);
                            setOpen(true);
                            openRoute(item.route);
                            setPickerOpen(false);
                          } catch (error) {
                            setSourceError(
                              error instanceof Error
                                ? error.message
                                : "Couldn’t add integration. Try again.",
                            );
                          } finally {
                            addingRef.current = false;
                            setAdding(undefined);
                          }
                        }}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:!size-[18px] [&_img]:!size-[18px]">
                          <DestinationIcon appId={props.appId} item={item} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {adding === item.id ? (
                          <span className="text-xs text-cream-muted">Opening…</span>
                        ) : selected ? (
                          <Check aria-hidden size={16} />
                        ) : !added ? (
                          <span className="rounded-md bg-cream-bright px-2.5 py-1 text-xs font-medium text-charcoal-bg">
                            Add
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {!filteredSources.length && (
                    <p className="px-3 py-6 text-center text-xs text-cream-muted">
                      No integrations found.
                    </p>
                  )}
                </div>
                {sourceError && (
                  <p
                    role="alert"
                    className="border-t border-charcoal-border px-3 py-2 text-xs text-cream"
                  >
                    {sourceError}
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </Renameable>
      <CollapsibleContent id={contentId}>
        {props.appId === "browser" && !items.length && (
          <p className="px-5 py-2 text-xs text-cream-muted">Pin pages from the toolbar.</p>
        )}
        {integrations && source && source.id !== "misty" && !sourceDestinations.length && (
          <p className="px-5 py-2 text-xs text-cream-muted">
            Pin pages from the {source.label} toolbar.
          </p>
        )}
        <AppItems
          accountId={props.accountId}
          path={integrations && source ? [source.id] : []}
          appId={props.appId}
          items={integrations ? sourceDestinations : items}
          activeRoute={props.active ? props.activeRoute : ""}
          label={`${label} destinations`}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function sameRoute(left: string, right: string) {
  if (!right) return false;
  const normalize = (route: string) => {
    const url = new URL(route, "https://misty.local");
    url.searchParams.delete("drawer");
    url.searchParams.delete("manage");
    url.searchParams.sort();
    return `${url.pathname}${url.search}${url.hash}`;
  };
  return normalize(left) === normalize(right);
}
function hasSelectedDescendant(
  items: readonly MistyNavigationItem[] | undefined,
  route: string,
): boolean {
  return !!items?.some(
    (item) => sameRoute(item.route, route) || hasSelectedDescendant(item.children, route),
  );
}
function isPinnedDestination(item: MistyNavigationItem) {
  return (
    item.id.startsWith("pin-") ||
    !!new URL(item.route, "https://misty.local").searchParams.get("pin")
  );
}
function pinnedDestinations(items: readonly MistyNavigationItem[] = []): MistyNavigationItem[] {
  return items.flatMap((item) => {
    const children = pinnedDestinations(item.children);
    const pinned = isPinnedDestination(item);
    return pinned || children.length ? [{ ...item, children }] : [];
  });
}

type AppItemsProps = {
  accountId: string;
  appId: NavigatorAppId;
  path: string[];
  items: readonly MistyNavigationItem[];
  activeRoute: string;
  label: string;
};
function AppItems(props: AppItemsProps) {
  const section = `${props.appId}:${props.path.map(encodeURIComponent).join("/")}`;
  const order = useNavigatorOrder(
    props.accountId,
    section,
    props.items.map((item) => item.id),
  );
  const items = order.ids.flatMap((id) => props.items.filter((item) => item.id === id));
  const drag = usePointerReorder({
    scope: `navigator:${props.accountId}:${section}`,
    axis: "y",
    getDrag: (id) => {
      const item = items.find((item) => item.id === id);
      return item ? { id, label: item.label } : null;
    },
    onDrop: (drag, target, after) => order.move(drag.id, target, after),
    onKeyboardMove: order.step,
  });
  return (
    <div {...drag} className={navigationMenuGroupClass} role="group" aria-label={props.label}>
      {items.map((item, index) => (
        <div key={item.id} data-reorder-item={item.id}>
          <AppItem {...props} item={item} last={index === items.length - 1} />
        </div>
      ))}
    </div>
  );
}

function AppItem(props: AppItemsProps & { item: MistyNavigationItem; last: boolean }) {
  const original = props.item;
  const pinned = isPinnedDestination(original);
  const [unpinning, setUnpinning] = useState(false);
  const [unpinError, setUnpinError] = useState("");
  const unpinPending = useRef(false);
  const nameKey = itemNameKey(props.appId, [...props.path, original.id]);
  const label = useNavigationName(nameKey, original.label);
  const item = { ...original, label };
  const path = [...props.path, item.id];
  const selectedDescendant = hasSelectedDescendant(item.children, props.activeRoute);
  const [open, setOpen] = useNavigatorDisclosureState(
    props.accountId,
    `item:${props.appId}:${path.map(encodeURIComponent).join("/")}`,
    selectedDescendant,
  );
  const contentId = useId();
  // Reveal a newly selected destination, but let the user collapse the active
  // branch without a rerender immediately opening it again.
  useEffect(() => {
    if (selectedDescendant) setOpen(true);
  }, [props.activeRoute, selectedDescendant, setOpen]);
  const hasChildren = !!item.children?.length;
  const selectedBranch = sameRoute(item.route, props.activeRoute) || selectedDescendant;
  const resume = useNavigatorResume({
    accountId: props.accountId,
    key: `${props.appId}:${path.join("/")}`,
    fallbackRoute: item.route,
    activeRoute: selectedBranch ? props.activeRoute : undefined,
    matchesRoute: (route) =>
      sameRoute(item.route, route) || hasSelectedDescendant(item.children, route),
  });
  const unpin = async () => {
    if (unpinPending.current) return;
    unpinPending.current = true;
    setUnpinning(true);
    setUnpinError("");
    try {
      await removeNavigatorPin(props.accountId, props.appId, original);
    } catch {
      setUnpinError("Couldn’t unpin. Try again.");
    } finally {
      unpinPending.current = false;
      setUnpinning(false);
    }
  };
  const activate = () => {
    if (selectedBranch && open) setOpen(false);
    else {
      setOpen(true);
      resume();
    }
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`relative ${navigationMenuGroupClass}`}
    >
      <Renameable nameKey={nameKey} automatic={original.label}>
        <NavigationTreeItem
          asChild
          icon={
            pinned ? <Link2 aria-hidden /> : <DestinationIcon appId={props.appId} item={item} />
          }
          label={item.label}
          action={
            pinned ? (
              <button
                type="button"
                className={`${navigationMenuActionClass} !opacity-0 group-hover/tree-row:!opacity-100 group-focus-within/tree-row:!opacity-100 [@media(hover:none)]:!opacity-100 disabled:cursor-wait`}
                aria-label={`Unpin ${label}`}
                title="Unpin"
                aria-busy={unpinning || undefined}
                disabled={unpinning}
                data-reorder-ignore="true"
                data-misty-window-drag-block="true"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void unpin();
                }}
              >
                <PinOff aria-hidden className="size-4" />
              </button>
            ) : undefined
          }
          selected={
            (sameRoute(item.route, props.activeRoute) && !(open && selectedDescendant)) ||
            (!open && selectedDescendant)
          }
          last={props.last}
          disclosure={
            hasChildren && !pinned ? { open, onActivate: activate, controls: contentId } : undefined
          }
        >
          <Link
            to={item.route}
            data-reorder-handle="true"
            data-misty-window-drag-block="true"
            title={`${label} · Drag to reorder · Alt+Shift+↑/↓`}
            onClick={() => {
              if (hasChildren) setOpen(true);
              const surface = workspaceSurfaceFromRoute(item.route);
              if (surface) useWorkspaceStore.getState().openSurface(surface);
            }}
          />
        </NavigationTreeItem>
      </Renameable>
      {unpinError && (
        <p role="alert" className="ml-8 px-2 text-xs text-cream-muted">
          {unpinError}
        </p>
      )}
      {hasChildren && open && !props.last ? (
        <span aria-hidden="true" className={navigationTreeContinuationClass} />
      ) : null}
      {hasChildren ? (
        <CollapsibleContent id={contentId}>
          <div className="relative ml-[27px]">
            <AppItems
              {...props}
              path={path}
              items={item.children!}
              label={`${item.label} destinations`}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

export function DestinationIcon({
  appId,
  item,
}: {
  appId: NavigatorAppId;
  item: MistyNavigationItem;
}) {
  if (appId === "files") {
    if (item.id === "explorer") return <ExplorerDestinationIcon aria-hidden />;
    if (item.id === "transfers") return <TransfersDestinationIcon aria-hidden />;
  }
  if (isPinnedDestination(item)) return <Link2 aria-hidden />;
  if (item.id === "misty") return <MistyBrandIcon size={18} />;
  if (Object.prototype.hasOwnProperty.call(websiteIntegrations, item.id))
    return <WebsiteBrandIcon id={item.id as WebsiteIntegrationId} size={18} />;
  const nativeIcon = {
    notes: NotesDestinationIcon,
    tasks: TasksDestinationIcon,
    agenda: AgendaDestinationIcon,
    roadmaps: RoadmapsDestinationIcon,
    drawings: DrawingsDestinationIcon,
  }[item.id];
  if (nativeIcon) {
    const Icon = nativeIcon;
    return <Icon aria-hidden />;
  }
  if (item.id === "integrations" && (appId === "social" || appId === "inbox"))
    return <Plug aria-hidden />;
  if (appId === "social" || appId === "inbox") {
    const provider = providerFromRoute(item.route, appId === "social" ? "chat" : "inbox");
    if (provider) return <ProviderBrandIcon provider={provider} size={18} />;
  }
  if (appId === "inbox") {
    const provider =
      new URL(item.route, "https://misty.local").searchParams.get("provider") ?? item.id;
    if (provider === "google" || provider === "microsoft")
      return <MailProviderIcon provider={provider} />;
  }
  if (appId === "social") {
    const provider = providerFromRoute(
      `/apps/social?provider=${encodeURIComponent(item.id)}`,
      "chat",
    );
    if (provider) return <ProviderBrandIcon provider={provider} size={18} />;
  }
  if (appId === "library") {
    const Icon = {
      recent: AllItemsDestinationIcon,
      favorites: FavoritesDestinationIcon,
      collections: CollectionsDestinationIcon,
      albums: AlbumsDestinationIcon,
      deleted: DeletedDestinationIcon,
    }[item.id];
    if (Icon) return <Icon aria-hidden />;
  }
  if (appId === "agents") {
    const Icon = item.id === "automations" ? Workflow : BotMessageSquare;
    return <Icon aria-hidden />;
  }
  return <FileText aria-hidden />;
}
