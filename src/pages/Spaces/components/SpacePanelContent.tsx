import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Bot, Briefcase, Check, ChevronDown, HardDrive, MessageSquare, MessagesSquare, Plus, Settings2, Sparkles, Users, Workflow, X } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../../auth/AuthContext";
import { sidebarStyles } from "../../Files/components/ExplorerSidebarSupport";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { agentArchitectureApi } from "../../../spaces/agentArchitectureApi";
import { spacesApi } from "../../../spaces/api";
import type { AgentConversation, Space, SpaceConversation, SpaceMember, SpaceStorageUsage, SpaceStudioResource, SpacesSnapshot } from "../../../spaces/types";
import { useSpacesStore } from "../../../stores/useSpacesStore";
import { SpaceSectionNavigation } from "./SpaceSectionNavigation";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceStudioResource[] = [];
const validSections = new Set(["chat", "agents", "tasks", "library", "studio", "members", "settings"]);
const validSettingsSections = new Set(["general", "chat", "studio", "agents"]);
type SpaceMenuState = { left: number; top: number; width: number };

export function SpacePanelContent(props: {
  spaces: Space[];
  limits: SpacesSnapshot["limits"] | null;
  loading: boolean;
  onAddSpace: (trigger: HTMLElement) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const routeParts = location.pathname.split("/").filter(Boolean);
  const activeSpaceId = routeParts[0] === "spaces" ? routeParts[1] ?? "" : "";
  const activeSpace = props.spaces.find((space) => space.id === activeSpaceId);
  const routeSection = routeParts[2] === "files" ? "library" : routeParts[2] ?? "chat";
  const section = validSections.has(routeSection) ? routeSection : "chat";
  const studioKind = routeParts[3] === "workflows" ? "workflows" : "agents";
  const settingsSection = validSettingsSections.has(routeParts[3] ?? "") ? routeParts[3] : "general";
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const libraryCollection = search.get("collection") ?? "recent";
  const collectionsActive = libraryCollection !== "recent";
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<SpaceConversation[]>([]);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [spaceMenu, setSpaceMenu] = useState<SpaceMenuState | null>(null);
  const [libraryUsage, setLibraryUsage] = useState<SpaceStorageUsage | null>(null);
  const groupDialogTriggerRef = useRef<HTMLElement | null>(null);
  const spaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const spaceMenuRef = useRef<HTMLDivElement | null>(null);
  const groupDialog = useDialogFocus<HTMLFormElement>(groupDialogOpen, groupDialogTriggerRef);
  const { members, agents, loadMembers, loadChatAgents } = useSpacesStore(useShallow((state) => ({
    members: state.membersBySpace[activeSpaceId] ?? emptyMembers,
    agents: state.agentsBySpace[activeSpaceId] ?? emptyAgents,
    loadMembers: state.loadMembers,
    loadChatAgents: state.loadChatAgents,
  })));

  useEffect(() => {
    if (props.loading || activeSpace || props.spaces.length === 0) return;
    const fallback = props.spaces.find((space) => space.is_personal) ?? props.spaces[0];
    const fallbackSection = fallback.is_personal && section === "chat" ? "library" : section;
    navigate(spaceSectionPath(fallback.id, fallbackSection, studioKind, settingsSection), { replace: true });
  }, [activeSpace, navigate, props.loading, props.spaces, section, settingsSection, studioKind]);

  useEffect(() => {
    if (!activeSpaceId) return;
    void loadMembers(activeSpaceId);
    if (activeSpace?.permissions?.["studio.view"] !== false || activeSpace?.permissions?.["agents.run"] !== false) void loadChatAgents(activeSpaceId);
    if (activeSpace?.permissions?.["messages.read"] === false) {
      setAgentConversations([]);
      setGroupConversations([]);
      return;
    }
    let active = true;
    void agentArchitectureApi.conversations().then((result) => {
      if (active) setAgentConversations(result.conversations.filter((conversation) => conversation.space_id === activeSpaceId));
    }).catch(() => { if (active) setAgentConversations([]); });
    void spacesApi.conversations(activeSpaceId).then((result) => {
      if (active) setGroupConversations(result.conversations);
    }).catch(() => { if (active) setGroupConversations([]); });
    return () => { active = false; };
  }, [activeSpace?.permissions, activeSpaceId, loadChatAgents, loadMembers]);

  useEffect(() => {
    if (!activeSpaceId) return;
    const reload = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== activeSpaceId) return;
      void spacesApi.conversations(activeSpaceId).then(({ conversations }) => setGroupConversations(conversations)).catch(() => undefined);
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
      void spacesApi.libraryUsage(activeSpaceId).then((usage) => {
        if (active) setLibraryUsage(usage);
      }).catch(() => {
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

  useEffect(() => {
    if (!spaceMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && spaceButtonRef.current?.contains(target)) return;
      if (target && spaceMenuRef.current?.contains(target)) return;
      setSpaceMenu(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSpaceMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [spaceMenu]);

  const switchSpace = (spaceId: string) => {
    if (!spaceId || spaceId === activeSpaceId) return;
    const nextSpace = props.spaces.find((space) => space.id === spaceId);
    const nextSection = nextSpace?.is_personal && section === "chat" ? "library" : section;
    navigate(spaceSectionPath(spaceId, nextSection, studioKind, settingsSection));
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
    if (!activeSpaceId || !groupTitle.trim() || selectedMemberIds.length === 0 || groupSaving) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      const created = await spacesApi.createConversation(activeSpaceId, groupTitle.trim(), selectedMemberIds);
      setGroupConversations((current) => [created, ...current]);
      setGroupDialogOpen(false);
      setGroupTitle("");
      setSelectedMemberIds([]);
      navigate(`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(created.id)}`);
    } catch (reason) {
      setGroupError(reason instanceof Error ? reason.message : "The group chat could not be created.");
    } finally {
      setGroupSaving(false);
    }
  };

  const conversationByAgent = new Map(agentConversations.map((conversation) => [conversation.agent_id, conversation]));
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const canAddSpace = (props.limits?.remaining_owned ?? 1) > 0;

  return <>
    <section className="mb-3">
      <button
        ref={spaceButtonRef}
        className={`${sidebarStyles.workspaceSelect} !h-9 !py-0`}
        type="button"
        aria-label={`Switch Space${activeSpace?.name ? `, current Space: ${activeSpace.name}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(spaceMenu)}
        title={activeSpace?.name ?? "Spaces"}
        disabled={props.loading || props.spaces.length === 0}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const width = Math.max(220, rect.width);
          setSpaceMenu((current) => current ? null : {
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 260)),
            width,
          });
        }}
      >
        <Briefcase className="shrink-0" size={20}/>
        <span className="min-w-0 flex-1 truncate whitespace-nowrap font-medium leading-5">{activeSpace?.name ?? "Spaces"}</span>
        <ChevronDown className="shrink-0" size={15}/>
      </button>
    </section>

    {props.loading && props.spaces.length === 0 ? <p className="mb-3 px-2 text-[10px] text-[var(--misty-text-subtle)]">Loading Spaces…</p> : null}
    {activeSpaceId ? <SpaceSectionNavigation spaceId={activeSpaceId} section={section}/> : null}
    {section === "library" && activeSpaceId ? <nav className="mt-3 grid grid-cols-2 gap-1" aria-label="Library views">
      <Link className={libraryViewLinkClass(!collectionsActive)} aria-current={!collectionsActive ? "page" : undefined} to={`/spaces/${encodeURIComponent(activeSpaceId)}/library?collection=recent`}>Library</Link>
      <Link className={libraryViewLinkClass(collectionsActive)} aria-current={collectionsActive ? "page" : undefined} to={`/spaces/${encodeURIComponent(activeSpaceId)}/library?collection=collections`}>Collections</Link>
    </nav> : null}

    <div className="mt-3 border-t border-[var(--misty-divider-subtle)] pt-3">
      {section === "chat" ? <nav className="grid gap-1" aria-label="Space conversations">
        {enabledAgents.map((agent) => {
          const conversation = conversationByAgent.get(agent.id);
          const params = new URLSearchParams({ agentId: agent.id });
          if (conversation) params.set("agentConversationId", conversation.id);
          return <Link className={conversationLinkClass(search.get("agentId") === agent.id)} key={agent.id} to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?${params.toString()}`}><span className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-200"><Bot size={15}/></span><span className="min-w-0 truncate font-medium">{agent.name}</span></Link>;
        })}
        {enabledAgents.length === 0 ? <p className={emptyClass}>No Agents</p> : null}
        <div className="my-1 border-t border-[var(--misty-divider-subtle)]"/>
        {activeSpaceId ? <Link className={conversationLinkClass(!search.has("conversation") && !search.has("agentId"))} to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat`}><span className="grid size-8 place-items-center rounded-lg bg-[var(--misty-surface-3)]"><Users size={15}/></span><span className="min-w-0 truncate font-medium">Everyone</span></Link> : null}
        {groupConversations.map((conversation) => <Link className={conversationLinkClass(search.get("conversation") === conversation.id)} key={conversation.id} to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}><span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-200"><MessagesSquare size={15}/></span><span className="min-w-0"><span className="block truncate font-medium">{conversation.title}</span><span className="mt-0.5 block truncate text-[9px] text-[var(--misty-text-subtle)]">{conversation.members.map((member) => member.user_id === user?.id ? "You" : member.name).join(", ")}</span></span></Link>)}
        {activeSpaceId && members.some((member) => member.user_id !== user?.id) ? <button className={addRowClass} type="button" onClick={(event) => { groupDialogTriggerRef.current = event.currentTarget; setGroupDialogOpen(true); }}><Plus size={15}/><span>Add group chat</span></button> : null}
      </nav> : null}

      {section === "library" ? <section className="rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] p-3" aria-label="Space storage quota">
        <div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--misty-surface-3)] text-[var(--misty-text-muted)]"><HardDrive size={15}/></span><span className="min-w-0"><strong className="block text-xs font-medium text-[var(--misty-text)]">Storage left</strong><span className="mt-0.5 block text-[10px] text-[var(--misty-text-subtle)]">{libraryUsage ? formatStorageBytes(libraryUsage.remaining_bytes, libraryUsage.limit_bytes) : "Checking…"}</span></span></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--misty-surface-3)]" aria-hidden="true"><span className="block h-full rounded-full bg-[var(--misty-primary)] transition-[width]" style={{ width: `${libraryUsage ? Math.max(0, Math.min(100, libraryUsage.used_bytes / Math.max(1, libraryUsage.limit_bytes) * 100)) : 0}%` }}/></div>
        {libraryUsage ? <p className="mb-0 mt-2 text-[9px] text-[var(--misty-text-subtle)]">{formatStorageBytes(libraryUsage.used_bytes)} used of {formatStorageBytes(libraryUsage.limit_bytes)}</p> : null}
      </section> : null}

      {section === "agents" ? <nav className="grid gap-1" aria-label="Agent Center"><NavLink className={panelRouteLinkClass} to={`/spaces/${encodeURIComponent(activeSpaceId)}/agents/attention`}><span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-200"><Bot size={15}/></span><span>Attention</span></NavLink><NavLink className={panelRouteLinkClass} to={`/spaces/${encodeURIComponent(activeSpaceId)}/agents/studio/agents`}><span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-200"><Workflow size={15}/></span><span>Studio</span></NavLink></nav> : null}

      {section === "members" ? <section aria-label="Space members">
        <div className="grid gap-1">{members.map((member) => <div className="grid min-h-12 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-xl px-2.5 text-xs text-[var(--misty-text-muted)]" key={member.user_id}><span className="grid size-8 place-items-center rounded-lg bg-[var(--misty-surface-3)] text-[10px] font-bold text-[var(--misty-text)]">{member.name.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate font-medium text-[var(--misty-text)]">{member.user_id === user?.id ? `${member.name} (You)` : member.name}</span><span className="mt-0.5 block truncate text-[9px] capitalize text-[var(--misty-text-subtle)]">{member.role}</span></span></div>)}</div>
        {members.length === 0 ? <p className={emptyClass}>No members to show.</p> : null}
      </section> : null}

      {section === "settings" ? <nav className="grid gap-1" aria-label="Space settings sections">
        <SettingsPanelLink active={settingsSection === "general"} icon={Settings2} label="General" to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/general`}/>
        <SettingsPanelLink active={settingsSection === "chat"} icon={MessageSquare} label="Chat" to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/chat`}/>
        <SettingsPanelLink active={settingsSection === "studio"} icon={Sparkles} label="Studio" to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/studio`}/>
        <SettingsPanelLink active={settingsSection === "agents"} icon={Bot} label="Agents" to={`/spaces/${encodeURIComponent(activeSpaceId)}/settings/agents`}/>
      </nav> : null}
    </div>

    {spaceMenu ? createPortal(<div ref={spaceMenuRef} className={`${sidebarStyles.menu} ${sidebarStyles.workspaceMenu}`} style={{ left: spaceMenu.left, top: spaceMenu.top, width: spaceMenu.width }} role="menu" aria-label="Spaces">
      {props.spaces.map((space) => <div className={`${sidebarStyles.workspaceMenuRow} !h-auto min-h-[34px] ${space.id === activeSpaceId ? sidebarStyles.menuButtonSelected : ""}`} key={space.id}>
        <button className={sidebarStyles.workspaceMenuSelect} type="button" role="menuitemradio" aria-checked={space.id === activeSpaceId} onClick={() => { setSpaceMenu(null); switchSpace(space.id); }}>
          <span className={sidebarStyles.menuButtonCheck}>{space.id === activeSpaceId ? <Check size={15}/> : null}</span>
          <span className="min-w-0 flex-1 whitespace-normal break-words py-2 leading-4">{space.name}</span>
        </button>
        <span className={sidebarStyles.workspaceMenuActions}><button className={sidebarStyles.workspaceMenuIconButton} type="button" title={`${space.name} settings`} aria-label={`Open settings for ${space.name}`} onClick={() => { setSpaceMenu(null); navigate(`/spaces/${encodeURIComponent(space.id)}/settings/general`); }}><Settings2 size={14}/></button></span>
      </div>)}
      <div className={sidebarStyles.menuSeparator}/>
      <button className={sidebarStyles.menuButton} type="button" role="menuitem" disabled={!canAddSpace} title={canAddSpace ? "New Space" : "You already own three Spaces"} onClick={(event) => { setSpaceMenu(null); props.onAddSpace(event.currentTarget); }}><span className={sidebarStyles.menuButtonIcon}><Plus size={15}/></span><span>New</span></button>
    </div>, document.body) : null}

    {groupDialogOpen ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeGroupDialog(); }}><form ref={groupDialog.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onKeyDown={(event) => { if (event.key === "Escape" && !groupSaving) { event.preventDefault(); closeGroupDialog(); } else groupDialog.trapFocus(event); }} onSubmit={(event) => void createGroup(event)}><div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-base font-semibold" id="create-group-title">Create a group chat</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">Only selected members can see this conversation.</p></div><button className={iconButtonClass} type="button" disabled={groupSaving} onClick={closeGroupDialog} aria-label="Close create group dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Group name<input className={inputClass} data-dialog-autofocus maxLength={80} placeholder="Launch crew" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)}/></label><fieldset className="mt-4 grid gap-1 border-0 p-0"><legend className="mb-2 text-xs font-medium text-[var(--misty-text-muted)]">Members</legend>{members.filter((member) => member.user_id !== user?.id).map((member) => <label className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs hover:bg-[var(--misty-surface-2)]" key={member.user_id}><input type="checkbox" checked={selectedMemberIds.includes(member.user_id)} onChange={(event) => setSelectedMemberIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))}/><span className="min-w-0"><span className="block truncate">{member.name}</span><span className="block truncate text-[9px] text-[var(--misty-text-subtle)]">{member.email}</span></span></label>)}</fieldset>{groupError ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs text-red-200" role="alert">{groupError}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={groupSaving} onClick={closeGroupDialog}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={groupSaving || !groupTitle.trim() || selectedMemberIds.length === 0}>{groupSaving ? "Creating…" : "Create group"}</button></div></form></div> : null}
  </>;
}

function SettingsPanelLink({ active, icon: Icon, label, to }: { active: boolean; icon: typeof Settings2; label: string; to: string }) {
  return <Link className={settingsLinkClass(active)} to={to}><span className="grid size-8 place-items-center rounded-lg border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))]"><Icon size={15}/></span><span className="truncate font-medium">{label}</span></Link>;
}

function spaceSectionPath(spaceId: string, section: string, studioKind: string, settingsSection: string) {
  const destination = section === "studio" ? `agents/studio/${studioKind}` : section === "settings" ? `settings/${settingsSection}` : section;
  return `/spaces/${encodeURIComponent(spaceId)}/${destination}`;
}

function conversationLinkClass(isActive: boolean) { return `grid min-h-12 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 text-xs no-underline transition-colors ${isActive ? "border-[var(--misty-border-strong)] bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "border-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`; }
function libraryViewLinkClass(isActive: boolean) { return `grid h-9 place-items-center rounded-xl border px-2 text-xs font-medium no-underline transition-colors ${isActive ? "border-[var(--misty-border-strong)] bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "border-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`; }
function settingsLinkClass(isActive: boolean) { return `grid min-h-12 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 text-xs no-underline transition-colors ${isActive ? "border-[var(--misty-divider-strong)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] text-[var(--misty-text)]" : "border-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] hover:text-[var(--misty-text)]"}`; }
function panelRouteLinkClass({ isActive }: { isActive: boolean }) { return conversationLinkClass(isActive); }
const addRowClass = "mt-1 inline-flex min-h-10 w-full items-center gap-2 rounded-xl border border-dashed border-[var(--misty-border-strong)] bg-transparent px-2.5 text-left text-xs font-medium text-[var(--misty-text-muted)] transition-colors hover:border-white/30 hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)] disabled:cursor-not-allowed disabled:opacity-45";
const sectionLabelClass = "mb-2 mt-1 px-2 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]";
const emptyClass = "m-0 px-2 py-3 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]";
const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)] disabled:opacity-50";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";

function formatStorageBytes(bytes: number, unitScaleBytes = bytes): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, unitScaleBytes)) / Math.log(1000)));
  const value = bytes / 1000 ** index;
  const formatted = value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
  return `${formatted} ${units[index]}`;
}
