import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Bot, Check, MessageSquare, Sparkles, Users, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { SpaceStudioResource } from "../../../spaces/types";
import { useSpacesStore } from "../../../stores/useSpacesStore";

const validSections = new Set(["general", "chat", "studio", "agents"]);
const emptyResources: SpaceStudioResource[] = [];

export function SpaceSettings({ spaceId, section }: { spaceId: string; section: string }) {
  const activeSection = validSections.has(section) ? section : "general";
  const { space, agents, workflows, error, renameSpace, loadStudio, clearError } = useSpacesStore(useShallow((state) => ({
    space: state.spaces.find((item) => item.id === spaceId),
    agents: state.agentsBySpace[spaceId] ?? emptyResources,
    workflows: state.workflowsBySpace[spaceId] ?? emptyResources,
    error: state.error,
    renameSpace: state.renameSpace,
    loadStudio: state.loadStudio,
    clearError: state.clearError,
  })));
  const [name, setName] = useState(space?.name ?? "");
  const [saving, setSaving] = useState(false);
  const isOwner = space?.role === "owner";
  const canViewStudio = space?.permissions?.["studio.view"] !== false;

  useEffect(() => { setName(space?.name ?? ""); }, [space?.name]);
  useEffect(() => {
    if (!spaceId) return;
    if (canViewStudio) void Promise.all([loadStudio(spaceId, "agents"), loadStudio(spaceId, "workflows")]);
  }, [canViewStudio, loadStudio, spaceId]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!space || !isOwner || !nextName || nextName === space.name || saving) return;
    clearError();
    setSaving(true);
    try { await renameSpace(spaceId, nextName); }
    finally { setSaving(false); }
  };

  if (!space) return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">Loading Space settings…</div>;

  return <div className="h-full overflow-auto px-6 py-7 sm:px-8 sm:py-9">
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="sr-only">{sectionTitle(activeSection)}</h1>

      {activeSection === "general" ? <section className={cardClass} aria-labelledby="space-name-heading">
        <div className="flex items-start justify-between gap-5">
          <h2 className={cardTitleClass} id="space-name-heading">Space name</h2>
          <span className={statusPillClass}>{space.is_personal ? "Personal" : space.is_shared ? "Shared" : "Private"}</span>
        </div>
        <form className="mt-5 flex max-w-lg gap-2" onSubmit={(event) => void saveName(event)}>
          <input className={inputClass} aria-label="Space name" maxLength={80} disabled={!isOwner || saving} value={name} onChange={(event) => setName(event.target.value)}/>
          {isOwner ? <button className={primaryButtonClass} type="submit" disabled={saving || !name.trim() || name.trim() === space.name}>{saving ? "Saving…" : "Save"}</button> : null}
        </form>
        {!isOwner ? <p className="mb-0 mt-3 text-xs text-[var(--misty-text-subtle)]">Only the Space owner can change this.</p> : null}
        {error ? <button className="mt-4 w-full rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200" type="button" onClick={clearError}>{error}</button> : null}
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[var(--misty-divider-subtle)] pt-5 sm:grid-cols-3">
          <Fact label="Members" value={String(space.member_count)}/><Fact label="Your role" value={isOwner ? "Owner" : "Member"}/><Fact label="Access" value={space.is_shared ? "Shared" : "Private"}/>
        </div>
      </section> : null}

      {activeSection === "chat" ? <SettingsCard icon={<MessageSquare size={18}/>} title="Space chat">
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Fact label="People" value={`${space.member_count} member${space.member_count === 1 ? "" : "s"}`}/><Fact label="Available Agents" value={String(agents.filter((agent) => agent.enabled).length)}/>
        </div>
        <ActionLink to={`/spaces/${encodeURIComponent(spaceId)}/chat`} label="Open Chat"/>
      </SettingsCard> : null}

      {activeSection === "studio" ? <div className="grid gap-3 sm:grid-cols-2">
        <ManagementCard icon={<Bot size={18}/>} title="Agents" count={agents.length} detail="" to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents`}/>
        <ManagementCard icon={<Workflow size={18}/>} title="Workflows" count={workflows.length} detail="" to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/workflows`}/>
      </div> : null}

      {activeSection === "agents" ? <SettingsCard icon={<Sparkles size={18}/>} title="Agents">
        <div className="mt-5 grid gap-2">
          {agents.slice(0, 6).map((agent) => <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] px-3" key={agent.id}><span className="grid size-7 place-items-center rounded-lg bg-sky-500/10 text-sky-200"><Bot size={14}/></span><span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span><span className={`inline-flex items-center gap-1 text-[10px] ${agent.enabled ? "text-emerald-300" : "text-[var(--misty-text-subtle)]"}`}>{agent.enabled ? <Check size={11}/> : null}{agent.enabled ? "Available" : "Off"}</span></div>)}
          {agents.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--misty-border-strong)] px-4 py-7 text-center"><Users className="mx-auto text-[var(--misty-text-subtle)]" size={20}/><p className="mb-0 mt-2 text-xs text-[var(--misty-text-muted)]">No Agents have been added yet.</p></div> : null}
        </div>
        <ActionLink to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents`} label={agents.length === 0 ? "Add an Agent" : "Manage Agents"}/>
      </SettingsCard> : null}
    </div>
  </div>;
}

function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className={cardClass}><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] text-[var(--misty-text-muted)]">{icon}</span><h2 className={cardTitleClass}>{title}</h2></div>{children}</section>;
}

function ManagementCard({ icon, title, count, detail, to }: { icon: ReactNode; title: string; count: number; detail: string; to: string }) {
  return <Link className={`${cardClass} group block no-underline transition-colors hover:bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))]`} to={to}><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] text-[var(--misty-text-muted)]">{icon}</span><h2 className={cardTitleClass}>{title}</h2><span className={`${statusPillClass} ml-auto`}>{count}</span></div>{detail ? <p className={cardDescriptionClass}>{detail}</p> : null}</Link>;
}

function ActionLink({ to, label }: { to: string; label: string }) {
  return <Link className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] px-3 text-xs font-medium text-[var(--misty-text)] no-underline transition-colors hover:border-[var(--misty-divider-strong)]" to={to}>{label}<ArrowRight size={13}/></Link>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] px-3 py-2.5"><span className="block text-[10px] text-[var(--misty-text-subtle)]">{label}</span><span className="mt-0.5 block truncate text-xs font-medium capitalize text-[var(--misty-text)]">{value}</span></div>;
}

function sectionTitle(section: string) { return section === "chat" ? "Chat settings" : section === "studio" ? "Studio settings" : section === "agents" ? "Agent settings" : "Space settings"; }
const cardClass = "rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-5";
const cardTitleClass = "m-0 text-sm font-semibold text-[var(--misty-text)]";
const cardDescriptionClass = "mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-muted)]";
const statusPillClass = "shrink-0 rounded-full border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] px-2.5 py-1 text-[10px] font-medium text-[var(--misty-text-muted)]";
const inputClass = "min-h-10 min-w-0 flex-1 rounded-xl border border-[var(--misty-divider-default)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-interaction-focus)] disabled:opacity-60";
const primaryButtonClass = "inline-flex min-h-10 shrink-0 items-center rounded-xl border-0 bg-[var(--misty-primary)] px-4 text-xs font-medium text-[var(--misty-primary-contrast)] disabled:cursor-not-allowed disabled:opacity-45";
