import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Bot,
  Briefcase,
  Check,
  ChevronDown,
  Folder,
  HardDrive,
  Heart,
  Images,
  Map as MapIcon,
  MessageSquare,
  MessagesSquare,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAuth } from "../../../auth/AuthContext";
import { agentArchitectureApi } from "../../../spaces/agentArchitectureApi";
import { spacesApi } from "../../../spaces/api";
import type {
  AgentConversation,
  Space,
  SpaceConversation,
  SpaceMember,
  SpaceStorageUsage,
  SpaceStudioResource,
  SpacesSnapshot,
} from "../../../spaces/types";
import { useSpacesStore } from "../../../stores/useSpacesStore";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";
import { SpaceSidebarSection } from "./SpaceSidebarSection";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceStudioResource[] = [];
const validSections = new Set([
  "chat",
  "agents",
  "tasks",
  "library",
  "studio",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "chat", "studio", "agents"]);

export function SpacePanelContent(props: {
  spaces: Space[];
  limits: SpacesSnapshot["limits"] | null;
  loading: boolean;
  onAddSpace: () => void;
  notices?: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const routeParts = location.pathname.split("/").filter(Boolean);
  const activeSpaceId = routeParts[0] === "spaces" ? (routeParts[1] ?? "") : "";
  const activeSpace = props.spaces.find((space) => space.id === activeSpaceId);
  const routeSection = routeParts[2] === "files" ? "library" : (routeParts[2] ?? "chat");
  const section = validSections.has(routeSection) ? routeSection : "chat";
  const agentStudioActive =
    section === "studio" || (section === "agents" && routeParts[3] === "studio");
  const studioKindSegment =
    agentStudioActive && section === "agents" ? routeParts[4] : routeParts[3];
  const studioKind = studioKindSegment === "workflows" ? "workflows" : "agents";
  const settingsSection = validSettingsSections.has(routeParts[3] ?? "")
    ? routeParts[3]
    : "general";
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const libraryCollection = search.get("collection") ?? "recent";
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<SpaceConversation[]>([]);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [libraryUsage, setLibraryUsage] = useState<SpaceStorageUsage | null>(null);
  const { members, agents, loadMembers, loadChatAgents } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[activeSpaceId] ?? emptyMembers,
      agents: state.agentsBySpace[activeSpaceId] ?? emptyAgents,
      loadMembers: state.loadMembers,
      loadChatAgents: state.loadChatAgents,
    })),
  );

  useEffect(() => {
    if (props.loading || activeSpace || props.spaces.length === 0) return;
    const fallback = props.spaces.find((space) => space.is_personal) ?? props.spaces[0];
    const fallbackSection = fallback.is_personal && section === "chat" ? "library" : section;
    navigate(
      spaceSectionPath(
        fallback.id,
        fallbackSection,
        studioKind,
        settingsSection,
        agentStudioActive,
      ),
      { replace: true },
    );
  }, [
    activeSpace,
    agentStudioActive,
    navigate,
    props.loading,
    props.spaces,
    section,
    settingsSection,
    studioKind,
  ]);

  useEffect(() => {
    if (!activeSpaceId) return;
    void loadMembers(activeSpaceId);
    if (
      activeSpace?.permissions?.["studio.view"] !== false ||
      activeSpace?.permissions?.["agents.run"] !== false
    )
      void loadChatAgents(activeSpaceId);
    if (activeSpace?.permissions?.["messages.read"] === false) {
      setAgentConversations([]);
      setGroupConversations([]);
      return;
    }
    let active = true;
    void agentArchitectureApi
      .conversations()
      .then((result) => {
        if (active)
          setAgentConversations(
            result.conversations.filter((conversation) => conversation.space_id === activeSpaceId),
          );
      })
      .catch(() => {
        if (active) setAgentConversations([]);
      });
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
  }, [activeSpace?.permissions, activeSpaceId, loadChatAgents, loadMembers]);

  useEffect(() => {
    if (!activeSpaceId) return;
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
  }, [activeSpaceId]);

  useEffect(() => {
    if (section !== "library" || !activeSpaceId) {
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
  }, [activeSpaceId, section]);

  const switchSpace = (spaceId: string) => {
    if (!spaceId || spaceId === activeSpaceId) return;
    const nextSpace = props.spaces.find((space) => space.id === spaceId);
    const nextSection = nextSpace?.is_personal && section === "chat" ? "library" : section;
    navigate(
      spaceSectionPath(spaceId, nextSection, studioKind, settingsSection, agentStudioActive),
    );
  };
  const closeGroupDialog = () => {
    if (groupSaving) return;
    setGroupDialogOpen(false);
    setGroupTitle("");
    setSelectedMemberIds([]);
    setGroupError("");
  };
  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeSpaceId || !groupTitle.trim() || selectedMemberIds.length === 0 || groupSaving)
      return;
    setGroupSaving(true);
    setGroupError("");
    try {
      const created = await spacesApi.createConversation(
        activeSpaceId,
        groupTitle.trim(),
        selectedMemberIds,
      );
      setGroupConversations((current) => [created, ...current]);
      setGroupDialogOpen(false);
      setGroupTitle("");
      setSelectedMemberIds([]);
      navigate(
        `/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(created.id)}`,
      );
    } catch (reason) {
      setGroupError(
        reason instanceof Error ? reason.message : "The group chat could not be created.",
      );
    } finally {
      setGroupSaving(false);
    }
  };

  const conversationByAgent = new Map(
    agentConversations.map((conversation) => [conversation.agent_id, conversation]),
  );
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const canAddSpace = (props.limits?.remaining_owned ?? 1) > 0;
  const sidebarContext =
    section === "chat" ? (
      <div className="grid gap-3">
        {enabledAgents.length ? (
          <SpaceSidebarSection title="Agents">
            <nav className="grid gap-1" aria-label="Agent conversations">
              {enabledAgents.map((agent) => {
                const conversation = conversationByAgent.get(agent.id);
                const params = new URLSearchParams({ agentId: agent.id });
                if (conversation) params.set("agentConversationId", conversation.id);
                return (
                  <Link
                    className={conversationLinkClass(search.get("agentId") === agent.id)}
                    key={agent.id}
                    to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?${params.toString()}`}
                  >
                    <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                      <Bot size={14} />
                    </span>
                    <span className="min-w-0 truncate font-medium">{agent.name}</span>
                  </Link>
                );
              })}
            </nav>
          </SpaceSidebarSection>
        ) : null}

        <SpaceSidebarSection title="Conversations">
          <nav className="grid gap-1" aria-label="Space conversations">
            <Link
              className={conversationLinkClass(
                !search.has("conversation") && !search.has("agentId"),
              )}
              to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat`}
            >
              <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                <Users size={14} />
              </span>
              <span className="min-w-0 truncate font-medium">Everyone</span>
            </Link>
            {groupConversations.map((conversation) => (
              <Link
                className={conversationLinkClass(search.get("conversation") === conversation.id)}
                key={conversation.id}
                to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}
              >
                <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                  <MessagesSquare size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{conversation.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {conversation.members
                      .map((member) => (member.user_id === user?.id ? "You" : member.name))
                      .join(", ")}
                  </span>
                </span>
              </Link>
            ))}
            {members.some((member) => member.user_id !== user?.id) ? (
              <Button
                className="mt-1 h-10 w-full justify-start border-sidebar-border/60 bg-transparent px-2.5 text-sm text-sidebar-foreground shadow-none"
                variant="outline"
                type="button"
                onClick={() => setGroupDialogOpen(true)}
              >
                <Plus size={14} />
                <span>Add group chat</span>
              </Button>
            ) : null}
          </nav>
        </SpaceSidebarSection>
      </div>
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
                  ? `${formatStorageBytes(libraryUsage.remaining_bytes, libraryUsage.limit_bytes)} left`
                  : "Checking..."}
              </span>
            </span>
          </div>
          <Progress
            className="mt-3 h-1.5"
            value={
              libraryUsage
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      (libraryUsage.used_bytes / Math.max(1, libraryUsage.limit_bytes)) * 100,
                    ),
                  )
                : 0
            }
          />
          {libraryUsage ? (
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
            active={settingsSection === "studio"}
            icon={Sparkles}
            label="Studio"
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/studio`}
          />
          <SettingsPanelLink
            active={settingsSection === "agents"}
            icon={Bot}
            label="Agents"
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/agents`}
          />
        </nav>
      </SpaceSidebarSection>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Popover open={spacePickerOpen} onOpenChange={setSpacePickerOpen}>
        <PopoverTrigger asChild>
          <Button
            className="mb-4 h-11 w-full min-w-0 justify-start gap-2.5 border-sidebar-border/60 bg-sidebar-accent/35 px-3 text-left text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent"
            variant="outline"
            type="button"
            aria-label={`Switch Space${activeSpace?.name ? `, current Space: ${activeSpace.name}` : ""}`}
            title={activeSpace?.name ?? "Spaces"}
            disabled={props.loading || props.spaces.length === 0}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
              <Briefcase size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {activeSpace?.name ?? "Spaces"}
            </span>
            <ChevronDown className="shrink-0 text-muted-foreground" size={15} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-1.5"
          align="start"
          sideOffset={6}
        >
          <p className="mb-1 px-2 py-1 text-xs font-semibold text-muted-foreground">Switch Space</p>
          <div className="misty-transient-scrollbar max-h-60 overflow-y-auto">
            {props.spaces.map((space) => (
              <div
                className={cn(
                  "group flex min-w-0 items-center rounded-md",
                  space.id === activeSpaceId && "bg-accent",
                )}
                key={space.id}
              >
                <Button
                  className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-2 bg-transparent px-2 py-1.5 text-left text-sm shadow-none hover:bg-accent"
                  variant="ghost"
                  type="button"
                  aria-current={space.id === activeSpaceId ? "true" : undefined}
                  onClick={() => {
                    setSpacePickerOpen(false);
                    switchSpace(space.id);
                  }}
                >
                  <span className="grid size-4 shrink-0 place-items-center text-primary">
                    {space.id === activeSpaceId ? <Check size={13} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{space.name}</span>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {space.is_personal
                        ? "Personal Space"
                        : space.is_shared
                          ? "Shared Space"
                          : "Private Space"}
                    </span>
                  </span>
                </Button>
                <Button
                  className="mr-1 size-7 shrink-0 opacity-60 shadow-none group-hover:opacity-100 group-focus-within:opacity-100"
                  size="icon"
                  variant="ghost"
                  type="button"
                  title={`${space.name} settings`}
                  aria-label={`Open settings for ${space.name}`}
                  onClick={() => {
                    setSpacePickerOpen(false);
                    navigate(`/spaces/${encodeURIComponent(space.id)}/settings/general`);
                  }}
                >
                  <Settings2 size={13} />
                </Button>
              </div>
            ))}
          </div>
          <Separator className="my-1" />
          <Button
            className="h-10 w-full justify-start px-2 text-sm shadow-none"
            variant="ghost"
            type="button"
            disabled={!canAddSpace}
            title={canAddSpace ? "New Space" : "You already own three Spaces"}
            onClick={() => {
              setSpacePickerOpen(false);
              props.onAddSpace();
            }}
          >
            <Plus size={14} />
            <span>New Space</span>
          </Button>
        </PopoverContent>
      </Popover>

      {props.loading && props.spaces.length === 0 ? (
        <p className="mb-3 px-2 text-xs text-muted-foreground">Loading Spaces...</p>
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

      <Dialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          if (open) setGroupDialogOpen(true);
          else closeGroupDialog();
        }}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={(event) => void createGroup(event)}>
            <DialogHeader>
              <DialogTitle>Create a group chat</DialogTitle>
              <DialogDescription>
                Only selected members can see this conversation.
              </DialogDescription>
            </DialogHeader>
            <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
              Group name
              <Input
                autoFocus
                maxLength={80}
                placeholder="Launch crew"
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
              />
            </label>
            <fieldset className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto border-0 p-0">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">Members</legend>
              {members
                .filter((member) => member.user_id !== user?.id)
                .map((member) => (
                  <label
                    className="flex min-h-10 items-center gap-3 rounded-md px-3 text-xs hover:bg-accent"
                    key={member.user_id}
                  >
                    <Checkbox
                      checked={selectedMemberIds.includes(member.user_id)}
                      onCheckedChange={(checked) =>
                        setSelectedMemberIds((current) =>
                          checked
                            ? [...current, member.user_id]
                            : current.filter((id) => id !== member.user_id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{member.name}</span>
                      <span className="block truncate text-[9px] text-muted-foreground">
                        {member.email}
                      </span>
                    </span>
                  </label>
                ))}
            </fieldset>
            {groupError ? (
              <p
                className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {groupError}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button
                variant="outline"
                type="button"
                disabled={groupSaving}
                onClick={closeGroupDialog}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={groupSaving || !groupTitle.trim() || selectedMemberIds.length === 0}
              >
                {groupSaving ? "Creating..." : "Create group"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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

export function spaceSectionPath(
  spaceId: string,
  section: string,
  studioKind: string,
  settingsSection: string,
  agentStudioActive = false,
) {
  const destination =
    section === "studio" || agentStudioActive
      ? `agents/studio/${studioKind}`
      : section === "settings"
        ? `settings/${settingsSection}`
        : section;
  return `/spaces/${encodeURIComponent(spaceId)}/${destination}`;
}

function conversationLinkClass(isActive: boolean) {
  return cn(
    "grid min-h-11 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-md px-2.5 text-sm no-underline outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}
function sidebarLinkClass(isActive: boolean) {
  return cn(
    "flex h-10 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}

const librarySidebarItems = [
  { collection: "recent", label: "All items", icon: Images },
  { collection: "favorites", label: "Favorites", icon: Heart },
  { collection: "collections", label: "Collections", icon: Folder },
  { collection: "albums", label: "Albums", icon: Images },
  { collection: "people", label: "People", icon: Users },
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
