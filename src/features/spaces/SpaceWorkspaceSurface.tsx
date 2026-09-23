import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpenText,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessagesSquare,
  Notebook,
} from "lucide-react";
import { useAuth } from "@/features/auth";
import { useWorkspaceTabFocused } from "@/features/workspace/WorkspaceTabRouteScope";
import type { WorkspaceTab } from "@/features/workspace/core";
import { Button } from "@/shared/ui";
import { SpaceSwitcher } from "./components/SpaceSwitcher";
import { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
import { SpaceSectionView, preloadSpaceSection } from "./SpaceSectionView";
import { preferredDefaultSpace } from "./defaultSpace";
import { useSpacesStore } from "./store/useSpacesStore";
import { useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
import { SpaceManagementNavigation } from "./components/SpaceManagementNavigation";
import { SpaceInvitationsNotice } from "./spacesShell/SpaceInvitationsNotice";
import { rememberedJournalRoute, rememberedPlannerRoute } from "./spacesShell/spaceSubpageMemory";
import "./spacePullSheets.css";

const tools = [
  { id: "social", label: "Chat", icon: MessagesSquare, permission: "messages.read" },
  { id: "planner", label: "Planner", icon: CalendarDays, permission: "tasks.view" },
  { id: "journal", label: "Journal", icon: Notebook, permission: null },
  { id: "library", label: "Library", icon: BookOpenText, permission: "library.view" },
] as const;

/** A pane-local sheet: it never changes dock geometry or another pane's route. */
export function SpaceWorkspaceSurface({ tab }: { tab: WorkspaceTab }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const focused = useWorkspaceTabFocused();
  const setViewingSpace = useSpacesStore((state) => state.setViewingSpace);
  const route = useSpacePanelRoute();
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  const error = useSpacesStore((state) => state.error);
  const load = useSpacesStore((state) => state.load);
  const invitations = useSpacesStore((state) => state.invitations);
  const respondInvite = useSpacesStore((state) => state.respondInvite);
  const space = spaces.find((item) => item.id === route.activeSpaceId);
  const fallback = preferredDefaultSpace(spaces);
  const [navOpen, setNavOpen] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const navigationRequest = useRef(0);
  const [open, setOpen] = useState(true);
  const [inviteError, setInviteError] = useState("");
  const pageRef = useRef<HTMLDivElement | null>(null);
  const activeTool =
    route.section === "notes" || route.section === "drawings"
      ? "journal"
      : route.section === "chat" || route.section === "home"
        ? "social"
        : route.section;

  useEffect(() => {
    if (!route.activeSpaceId && ready && fallback) {
      navigate(`/spaces/${encodeURIComponent(fallback.id)}/social`, { replace: true });
    }
  }, [fallback, ready, route.activeSpaceId, navigate]);
  useEffect(() => setOpen(true), [route.activeSpaceId, route.section]);

  useEffect(() => {
    if (!focused || !user || !space || !open) return;
    setViewingSpace(space.id);
    return () => setViewingSpace("");
  }, [focused, user, space, open, setViewingSpace]);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = pageRef.current?.animate?.(
      [{ transform: "translateX(32px)" }, { transform: "translateX(0)" }],
      { duration: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => animation?.cancel();
  }, [activeTool, route.activeSpaceId]);

  function toolPath(id: string) {
    if (id === "journal") return rememberedJournalRoute(user?.id ?? "", route.activeSpaceId);
    if (id === "planner") return rememberedPlannerRoute(user?.id ?? "", route.activeSpaceId);
    return `/spaces/${encodeURIComponent(route.activeSpaceId)}/${id}`;
  }
  async function chooseTool(id: string) {
    const request = ++navigationRequest.current;
    const path = toolPath(id);
    setNavigationError("");
    try {
      await preloadSpaceSection(path.split("/")[3]);
      if (request !== navigationRequest.current) return;
      startTransition(() => navigate(path));
      setOpen(true);
      setNavOpen(false);
      handleRef.current?.focus();
    } catch {
      if (request === navigationRequest.current)
        setNavigationError("Could not open this tool. Try again.");
    }
  }
  useEffect(
    () => () => {
      navigationRequest.current++;
    },
    [route.activeSpaceId],
  );
  useEffect(() => {
    if (!navOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        !navRef.current?.contains(target) &&
        !target.closest('[role="menu"], [role="dialog"], [data-slot="popover-content"]')
      )
        setNavOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [navOpen]);

  function close() {
    setOpen(false);
    handleRef.current?.focus();
  }

  if (!user)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to use Spaces</h1>
        <p className="text-sm text-cream-muted">
          Collaborate on projects with chat, planning, and shared materials.
        </p>
        <Button onClick={() => navigate("/signin", { state: { from: tab.route } })}>Sign in</Button>
      </div>
    );

  if (!ready)
    return (
      <div
        className="grid h-full place-content-center gap-3 text-center text-sm text-cream-muted"
        role="status"
      >
        <p>{error ? "Spaces could not be loaded." : "Loading Spaces…"}</p>
        {error && <Button onClick={() => void load({ force: true })}>Retry</Button>}
      </div>
    );

  if (!route.activeSpaceId)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="grid h-full place-content-center gap-4 p-6 text-center">
            <h1 className="text-xl font-semibold">Your project Spaces</h1>
            <p className="text-sm text-cream-muted">
              Chat, plan, and keep project materials together.
            </p>
            <SpaceInvitationsNotice
              invitations={invitations}
              onRespond={(id, accept) => {
                void respondInvite(id, accept).catch((reason: unknown) =>
                  setInviteError(
                    reason instanceof Error ? reason.message : "Could not respond to invitation.",
                  ),
                );
              }}
            />
            {inviteError && <p role="alert">{inviteError}</p>}
            <Button onClick={create}>Create Space</Button>
          </div>
        )}
      </GlobalCreateSpaceDialog>
    );

  return (
    <div className="space-pull-workspace" data-space-workspace={route.activeSpaceId}>
      <div
        ref={navRef}
        className="space-nav-drawer"
        data-open={navOpen}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !(event.target as HTMLElement).closest('[role="menu"]')
          ) {
            event.preventDefault();
            setNavOpen(false);
            handleRef.current?.focus();
          }
        }}
      >
        <Button
          ref={handleRef}
          className="space-nav-handle"
          aria-label={navOpen ? "Hide Space navigation" : "Show Space navigation"}
          aria-expanded={navOpen}
          aria-controls={`space-nav-${tab.id}`}
          onClick={() => setNavOpen((value) => !value)}
        >
          {navOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
        <nav
          id={`space-nav-${tab.id}`}
          className="space-pull-tabs"
          aria-label="Space tools"
          inert={!navOpen ? true : undefined}
          aria-hidden={!navOpen}
        >
          <SpaceSwitcher
            variant="pull-tab"
            activeSpace={space}
            activeSpaceId={route.activeSpaceId}
            spaces={spaces}
            userId={user?.id ?? ""}
            canAddSpace={Boolean(user)}
          />
          {tools
            .filter((tool) => !tool.permission || space?.permissions?.[tool.permission] !== false)
            .map((tool) => {
              const Icon = tool.icon;
              return (
                <Button
                  key={tool.id}
                  className="space-pull-tab"
                  aria-label={tool.label}
                  aria-current={activeTool === tool.id ? "page" : undefined}
                  data-selected={activeTool === tool.id}
                  onClick={() => void chooseTool(tool.id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{tool.label}</span>
                </Button>
              );
            })}
          {navigationError && (
            <p role="alert" className="px-2 text-xs text-cream-muted">
              {navigationError}
            </p>
          )}
        </nav>
      </div>
      <div className="space-sheet-rest" aria-hidden={open}>
        {!open && (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            Continue in {space?.name ?? "Space"}
          </Button>
        )}
      </div>
      <section
        id={`space-sheet-${tab.id}`}
        className="space-pull-sheet"
        data-open={open}
        aria-label={`${space?.name ?? "Space"} ${tools.find((tool) => tool.id === activeTool)?.label ?? "workspace"}`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !(event.target as HTMLElement).closest('[role="menu"], [role="dialog"]')
          ) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className="space-sheet-header">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-muted">
            {space?.name}
          </span>
          <SpaceManagementNavigation space={space} section={route.section} />
          <Button variant="ghost" size="icon-sm" aria-label="Close Space sheet" onClick={close}>
            <ChevronRight size={16} />
          </Button>
        </header>
        <div ref={pageRef} className="min-h-0 flex-1 overflow-hidden">
          <SpaceSectionView
            spaceId={route.activeSpaceId}
            section={route.section === "home" ? "social" : route.section}
            studioKind={route.section === "settings" ? route.settingsSection : route.drawingId}
            workspaceTabId={tab.id}
          />
        </div>
      </section>
    </div>
  );
}
