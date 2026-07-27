import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  Folder,
  HardDrive,
  Heart,
  Images,
  Map as MapIcon,
  MessageSquare,
  Plug,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Progress } from "@/ui";
import { Skeleton } from "@/ui";
import { Separator } from "@/ui";
import { cn } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import type {
  Space,
  SpaceMember,
  SpaceStorageUsage,
  SpacesSnapshot,
} from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpaceSidebarSection } from "./SpaceSidebarSection";
import { SpaceChatConversationList } from "./SpaceChatConversationList";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { spaceNotesEnabled } from "@/features/notes/availability";
import {
  CreateEditConversationDialog,
  type ConversationDialogKind,
} from "./CreateEditConversationDialog";

const emptyMembers: SpaceMember[] = [];
const validSections = new Set(["chat", "tasks", "notes", "library", "members", "settings"]);
const validSettingsSections = new Set(["general", "chat", "integrations"]);

export function SpacePanelContent(props: {
  spaces: Space[];
  limits: SpacesSnapshot["entitlements"] | null;
  loading: boolean;
  onAddSpace: () => void;
  notices?: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [spacesListSkeletonVisible] = useMinimumSpin(props.loading && props.spaces.length === 0);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const activeSpaceId = routeParts[0] === "spaces" ? decodeRouteSegment(routeParts[1] ?? "") : "";
  const activeSpace = props.spaces.find((space) => space.id === activeSpaceId);
  const routeSection = routeParts[2] === "files" ? "library" : (routeParts[2] ?? "chat");
  const section = validSections.has(routeSection) ? routeSection : "chat";
  const settingsSection = validSettingsSections.has(routeParts[3] ?? "")
    ? routeParts[3]
    : "general";
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const libraryCollection = search.get("collection") ?? "recent";
  const [groupConversations, setGroupConversations] = useState<SpaceConversation[]>([]);
  const [conversationDialogOpen, setConversationDialogOpen] = useState(false);
  const [conversationDialogKind, setConversationDialogKind] =
    useState<ConversationDialogKind>("group");
  const [editingConversation, setEditingConversation] = useState<SpaceConversation | null>(null);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [libraryUsage, setLibraryUsage] = useState<SpaceStorageUsage | null>(null);
  const { members, snapshotReady, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[activeSpaceId] ?? emptyMembers,
      snapshotReady: state.snapshotReady,
      loadMembers: state.loadMembers,
    })),
  );

  useEffect(() => {
    if (props.loading || activeSpace || props.spaces.length === 0) return;
    navigate(spaceSectionPath(props.spaces[0].id, section, settingsSection), { replace: true });
  }, [activeSpace, navigate, props.loading, props.spaces, section, settingsSection]);

  useEffect(() => {
    if (!user || !snapshotReady || !activeSpaceId || !activeSpace) {
      setGroupConversations([]);
      return;
    }
    void loadMembers(activeSpaceId);
    if (activeSpace?.permissions?.["messages.read"] === false) {
      setGroupConversations([]);
      return;
    }
    let active = true;
    void spacesApi
      .conversations(activeSpaceId)
      .then((result) => {
        if (active) setGroupConversations(result.conversations);
      })
      .catch(() => {
        if (active) setGroupConversations([]);
      });
    return () => {
      active = false;
    };
  }, [activeSpace, activeSpaceId, loadMembers, snapshotReady, user]);

  useEffect(() => {
    if (!snapshotReady || !activeSpaceId || !activeSpace) return;
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== activeSpaceId) return;
      void spacesApi
        .conversations(activeSpaceId)
        .then(({ conversations }) => setGroupConversations(conversations))
        .catch(() => undefined);
    };
    window.addEventListener("misty:space-conversation-event", reload);
    return () => window.removeEventListener("misty:space-conversation-event", reload);
  }, [activeSpace, activeSpaceId, snapshotReady]);

  useEffect(() => {
    if (section !== "library" || !snapshotReady || !activeSpaceId || !activeSpace) {
      setLibraryUsage(null);
      return;
    }
    let active = true;
    const loadUsage = () => {
      void spacesApi
        .libraryUsage(activeSpaceId)
        .then((usage) => {
          if (active) setLibraryUsage(usage);
        })
        .catch(() => {
          if (active) setLibraryUsage(null);
        });
    };
    const reloadOnLibraryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id === activeSpaceId) loadUsage();
    };
    loadUsage();
    window.addEventListener("misty:space-library-event", reloadOnLibraryEvent);
    return () => {
      active = false;
      window.removeEventListener("misty:space-library-event", reloadOnLibraryEvent);
    };
  }, [activeSpace, activeSpaceId, section, snapshotReady]);

  const switchSpace = (spaceId: string) => {
    if (!spaceId || spaceId === activeSpaceId) return;
    navigate(spaceSectionPath(spaceId, section, settingsSection));
  };
  const handleConversationSaved = (saved: SpaceConversation) => {
    setGroupConversations((current) => {
      const exists = current.some((conversation) => conversation.id === saved.id);
      return exists
        ? current.map((conversation) => (conversation.id === saved.id ? saved : conversation))
        : [saved, ...current];
    });
    navigate(
      `/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(saved.id)}`,
    );
  };

  const canAddSpace = props.limits?.unlimited_spaces !== false;
  const showsOwnerStorage = activeSpace?.owner_user_id === user?.id;
  // The active Space is the menu title, so it is not repeated in the list below.
  const otherSpaces = props.spaces.filter((space) => space.id !== activeSpaceId);
  const sidebarContext =
    section === "chat" ? (
      <div className="grid gap-3">
        <SpaceChatConversationList
          activeSpaceId={activeSpaceId}
          conversations={groupConversations}
          activeConversationId={search.get("conversation")}
          currentUserId={user?.id}
          onCreateConversation={(kind) => {
            setEditingConversation(null);
            setConversationDialogKind(kind);
            setConversationDialogOpen(true);
          }}
          onEditConversation={(conversation) => {
            setEditingConversation(conversation);
            setConversationDialogKind(conversation.members.length > 2 ? "group" : "direct");
            setConversationDialogOpen(true);
          }}
        />
      </div>
    ) : section === "notes" && spaceNotesEnabled ? (
      <NotesPanelSidebar spaceId={activeSpaceId} spaceName={activeSpace?.name ?? "Notes"} />
    ) : section === "library" ? (
      <div className="grid gap-3">
        <SpaceSidebarSection title="Browse">
          <nav className="grid gap-1" aria-label="Library collections">
            {librarySidebarItems.map(({ collection, label, icon }) => (
              <SpaceSidebarLink
                key={collection}
                active={libraryCollection === collection}
                icon={icon}
                label={label}
                to={`/spaces/${encodeURIComponent(activeSpaceId)}/library?collection=${collection}`}
              />
            ))}
          </nav>
        </SpaceSidebarSection>
        <Separator className="bg-sidebar-border" />
        <section className="rounded-md bg-sidebar-accent/35 p-3" aria-label="Space storage quota">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
              <HardDrive size={14} />
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-medium text-sidebar-accent-foreground">
                Storage
              </strong>
              <span className="block text-xs text-muted-foreground">
                {libraryUsage
                  ? showsOwnerStorage && libraryUsage.remaining_bytes !== undefined
                    ? `${formatStorageBytes(libraryUsage.remaining_bytes, libraryUsage.limit_bytes)} left across your Spaces`
                    : libraryUsage.storage_available
                      ? "Uploads available"
                      : "New uploads paused"
                  : "Checking..."}
              </span>
            </span>
          </div>
          {showsOwnerStorage &&
          libraryUsage?.used_bytes !== undefined &&
          libraryUsage.limit_bytes ? (
            <Progress
              className="mt-3 h-1.5"
              value={Math.max(
                0,
                Math.min(100, (libraryUsage.used_bytes / libraryUsage.limit_bytes) * 100),
              )}
            />
          ) : null}
          {showsOwnerStorage &&
          libraryUsage?.used_bytes !== undefined &&
          libraryUsage.limit_bytes ? (
            <p className="mb-0 mt-2 text-[11px] text-muted-foreground">
              {formatStorageBytes(libraryUsage.used_bytes)} of{" "}
              {formatStorageBytes(libraryUsage.limit_bytes)} used
            </p>
          ) : null}
        </section>
      </div>
    ) : section === "settings" ? (
      <SpaceSidebarSection title="Preferences">
        <nav className="grid gap-1" aria-label="Space settings sections">
          <SettingsPanelLink
            active={settingsSection === "general"}
            icon={Settings2}
            label="General"
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/general`}
          />
          <SettingsPanelLink
            active={settingsSection === "chat"}
            icon={MessageSquare}
            label="Chat"
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/chat`}
          />
          <SettingsPanelLink
            active={settingsSection === "integrations"}
            icon={Plug}
            label="Integrations"
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/integrations`}
          />
        </nav>
      </SpaceSidebarSection>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DropdownMenu open={spacePickerOpen} onOpenChange={setSpacePickerOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            className="mb-4 h-11 w-full min-w-0 justify-start gap-2.5 border-sidebar-border/60 bg-sidebar-accent/35 px-3 text-left text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent"
            variant="outline"
            type="button"
            aria-label={activeSpace?.name ? `Space menu: ${activeSpace.name}` : "Space menu"}
            title={activeSpace?.name ?? "Spaces"}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
              <Briefcase size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {activeSpace?.name ?? "Spaces"}
            </span>
            <ChevronDown className="shrink-0 text-muted-foreground" size={15} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px]"
          align="start"
          sideOffset={6}
        >
          <DropdownMenuLabel className="truncate">
            {activeSpace?.name ?? "Spaces"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={!activeSpaceId}
            onSelect={() => navigate(`/spaces/${encodeURIComponent(activeSpaceId)}/members`)}
          >
            <Users size={14} />
            Members
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeSpaceId}
            onSelect={() =>
              navigate(`/spaces/${encodeURIComponent(activeSpaceId)}/settings/general`)
            }
          >
            <Settings2 size={14} />
            Settings
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="truncate">New</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!canAddSpace}
            title={canAddSpace ? undefined : "You already own three Spaces"}
            onSelect={() => props.onAddSpace()}
          >
            <Plus size={14} />
            Add Space
          </DropdownMenuItem>

          {otherSpaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <div className="misty-transient-scrollbar max-h-60 overflow-y-auto">
                {otherSpaces.map((space) => (
                  <DropdownMenuItem
                    key={space.id}
                    className="gap-2"
                    onSelect={() => switchSpace(space.id)}
                  >
                    <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                      <Briefcase size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {spacesListSkeletonVisible ? (
        <div className="grid gap-2" aria-busy="true" role="status">
          <span className="sr-only">Loading Spaces</span>
          <Skeleton className="h-11 rounded-md" />
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-10 rounded-lg" />
            ))}
          </div>
          <Skeleton className="mt-2 h-9 rounded-md" />
          <Skeleton className="h-9 w-4/5 rounded-md" />
          <Skeleton className="h-9 w-3/5 rounded-md" />
        </div>
      ) : null}
      {props.notices ? (
        <div className="misty-transient-scrollbar mb-3 max-h-40 shrink-0 overflow-y-auto">
          {props.notices}
        </div>
      ) : null}
      {activeSpaceId ? (
        <SpaceSectionNavigation
          spaceId={activeSpaceId}
          section={section}
          context={sidebarContext}
        />
      ) : null}

      <CreateEditConversationDialog
        spaceId={activeSpaceId}
        open={conversationDialogOpen}
        onOpenChange={setConversationDialogOpen}
        members={members}
        currentUserId={user?.id}
        conversation={editingConversation}
        kindHint={conversationDialogKind}
        onSaved={handleConversationSaved}
      />
    </div>
  );
}

function SettingsPanelLink({
  active,
  icon: Icon,
  label,
  to,
}: {
  active: boolean;
  icon: typeof Settings2;
  label: string;
  to: string;
}) {
  return <SpaceSidebarLink active={active} icon={Icon} label={label} to={to} />;
}

function SpaceSidebarLink({
  active,
  icon: Icon,
  label,
  to,
}: {
  active: boolean;
  icon: typeof Settings2;
  label: string;
  to: string;
}) {
  return (
    <Link className={sidebarLinkClass(active)} to={to} aria-current={active ? "page" : undefined}>
      <span className="grid size-5 place-items-center text-muted-foreground">
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
    </Link>
  );
}

export function spaceSectionPath(spaceId: string, section: string, settingsSection: string) {
  const destination = section === "settings" ? `settings/${settingsSection}` : section;
  return `/spaces/${encodeURIComponent(spaceId)}/${destination}`;
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function sidebarLinkClass(isActive: boolean) {
  return cn(
    "flex h-10 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}

export const librarySidebarItems = [
  { collection: "recent", label: "All items", icon: Images },
  { collection: "smart", label: "Smart Library", icon: Sparkles },
  { collection: "favorites", label: "Favorites", icon: Heart },
  { collection: "collections", label: "Collections", icon: Folder },
  { collection: "albums", label: "Albums", icon: Images },
  { collection: "map", label: "Places", icon: MapIcon },
  { collection: "deleted", label: "Recently deleted", icon: Trash2 },
] as const;

function formatStorageBytes(bytes: number, unitScaleBytes = bytes): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(1, unitScaleBytes)) / Math.log(1000)),
  );
  const value = bytes / 1000 ** index;
  const formatted =
    value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
  return `${formatted} ${units[index]}`;
}
