import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FolderCog, Play, Plus, Save, Trash2, Workflow } from "lucide-react";
import { NavLink, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import AgentsPage from "../Agents";
import AutomationsPage from "../Automations";
import { useSpacesStore } from "../../stores/useSpacesStore";
import type { SpaceRun, SpaceStudioResource } from "../../spaces/types";
import { AgentArchitecturePanel } from "./AgentArchitecturePanel";

export type SpaceStudioKind = "agents" | "folder-agents" | "workflows";

export default function SpaceStudioPage({ spaceId, kind }: { spaceId: string; kind: SpaceStudioKind }) {
  const [searchParams] = useSearchParams();
  const { spaces, agentsBySpace, workflowsBySpace, load, loadStudio, saveStudio, deleteStudio, runStudio, error } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    agentsBySpace: state.agentsBySpace,
    workflowsBySpace: state.workflowsBySpace,
    load: state.load,
    loadStudio: state.loadStudio,
    saveStudio: state.saveStudio,
    deleteStudio: state.deleteStudio,
    runStudio: state.runStudio,
    error: state.error,
  })));
  const space = spaces.find((candidate) => candidate.id === spaceId);
  const personalSpaceId = spaces.find((candidate) => candidate.is_personal)?.id ?? spaceId;
  const resources = kind === "agents"
    ? agentsBySpace[spaceId] ?? emptyStudioResources
    : kind === "workflows"
      ? workflowsBySpace[spaceId] ?? emptyStudioResources
      : emptyStudioResources;

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (kind !== "folder-agents") void loadStudio(spaceId, kind); }, [kind, loadStudio, spaceId]);
  useEffect(() => { if (kind === "agents") void loadStudio(spaceId, "workflows"); }, [kind, loadStudio, spaceId]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[58px_minmax(0,1fr)] bg-[var(--misty-app-page-bg,#07090b)]">
      <header className="flex items-center gap-4 border-b border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-5">
        <div className="flex items-center gap-4">
          <div><p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">{space?.name ?? "Space"}</p><h1 className="m-0 text-sm font-semibold">Studio</h1></div>
          <nav className="flex rounded-xl bg-[var(--misty-surface-2)] p-1" aria-label="Studio sections">
            <NavLink className={studioTabClass} to={`/spaces/${encodeURIComponent(spaceId)}/studio/agents`}><Bot size={14}/>Agents</NavLink>
            <NavLink className={studioTabClass} to={`/spaces/${encodeURIComponent(spaceId)}/studio/folder-agents`}><FolderCog size={14}/>Folder agents</NavLink>
            <NavLink className={studioTabClass} to={`/spaces/${encodeURIComponent(spaceId)}/studio/workflows`}><Workflow size={14}/>Workflows</NavLink>
          </nav>
        </div>
      </header>
      <main className="min-h-0">
        {kind === "folder-agents"
          ? searchParams.get("agentId")
            ? <AutomationsPage spaceId={spaceId} personalSpaceId={personalSpaceId} />
            : <AgentsPage spaceId={spaceId} personalSpaceId={personalSpaceId} spaceName={space?.name ?? "This Space"} initialAgentId={searchParams.get("selectedAgentId") ?? undefined} />
          : <SharedStudio kind={kind} spaceId={spaceId} resources={resources} workflows={workflowsBySpace[spaceId] ?? emptyStudioResources} initialResourceId={searchParams.get("agentId") ?? undefined} error={error} saveStudio={saveStudio} deleteStudio={deleteStudio} runStudio={runStudio} />}
      </main>
    </div>
  );
}

function SharedStudio(props: {
  kind: "agents" | "workflows";
  spaceId: string;
  resources: SpaceStudioResource[];
  workflows: SpaceStudioResource[];
  initialResourceId?: string;
  error: string | null;
  saveStudio: ReturnType<typeof useSpacesStore.getState>["saveStudio"];
  deleteStudio: ReturnType<typeof useSpacesStore.getState>["deleteStudio"];
  runStudio: ReturnType<typeof useSpacesStore.getState>["runStudio"];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.initialResourceId ?? null);
  const [draft, setDraft] = useState<Partial<SpaceStudioResource> | null>(null);
  const [lastRun, setLastRun] = useState<SpaceRun | null>(null);
  const [running, setRunning] = useState(false);
  const appliedInitialResourceId = useRef("");
  const selected = props.resources.find((item) => item.id === selectedId) ?? props.resources[0] ?? null;

  useEffect(() => {
    if (selected) setDraft(selected);
    else setDraft(null);
  }, [props.spaceId, selected?.id, selected?.version]);
  useEffect(() => {
    if (props.initialResourceId && appliedInitialResourceId.current !== props.initialResourceId && props.resources.some((item) => item.id === props.initialResourceId)) {
      appliedInitialResourceId.current = props.initialResourceId;
      setSelectedId(props.initialResourceId);
    }
  }, [props.initialResourceId, props.resources]);

  const title = props.kind === "agents" ? "Space Agents" : "Space Workflows";
  const description = props.kind === "agents"
    ? "Cloud Agents can answer @mentions, use Space chat, and read only files explicitly attached to a run."
    : "Cloud Workflows stay available without a member device and reject local filesystem nodes.";
  const definitionText = useMemo(() => JSON.stringify(draft?.definition ?? { nodes: [] }, null, 2), [draft?.definition]);

  const createNew = () => {
    const fresh: Partial<SpaceStudioResource> = props.kind === "agents"
      ? { kind: "agent", name: "New Agent", description: "A capable teammate for this Space.", icon: "bot", instructions: "Help teammates in this Space.", enabled: true, status: "available", runtime_kind: "cloud", schedules_enabled: false, version: 0 }
      : { kind: "workflow", name: "New Workflow", definition: { nodes: [] }, enabled: false, schedules_enabled: false, version: 0 };
    setSelectedId(null); setDraft(fresh);
  };

  const save = async () => {
    if (!draft?.name?.trim()) return;
    try {
      const saved = await props.saveStudio(props.spaceId, props.kind, draft);
      setSelectedId(saved.id); setDraft(saved);
    } catch { /* server conflict is shown by the shared store */ }
  };

  const run = async () => {
    if (!draft?.id) return;
    const prompt = props.kind === "agents" ? window.prompt(`Ask ${draft.name}`, "Help me with this Space") : "";
    if (props.kind === "agents" && !prompt?.trim()) return;
    setRunning(true); setLastRun(null);
    try { setLastRun(await props.runStudio(props.spaceId, props.kind, draft.id, prompt?.trim() ?? "")); }
    finally { setRunning(false); }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[250px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto border-r border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-3">
        <div className="mb-3 flex items-center justify-between px-2"><div><h2 className="m-0 text-sm font-semibold">{title}</h2><span className="text-[10px] text-[var(--misty-text-subtle)]">Shared with every member</span></div><button className={iconButtonClass} type="button" onClick={createNew} aria-label={`Create ${props.kind === "agents" ? "Agent" : "Workflow"}`}><Plus size={15}/></button></div>
        <div className="grid gap-1">{props.resources.map((item) => <button className={`rounded-xl border-0 px-3 py-2.5 text-left ${selected?.id === item.id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span className="block truncate text-xs font-medium">{item.name}</span><span className="mt-1 block text-[9px] text-[var(--misty-text-subtle)]">v{item.version} · {item.enabled ? "Enabled" : "Disabled"}</span></button>)}</div>
      </aside>
      <section className="min-h-0 overflow-auto p-6">
        {!draft ? <div className="grid h-full place-items-center text-center"><div>{props.kind === "agents" ? <Bot className="mx-auto text-[var(--misty-text-subtle)]"/> : <Workflow className="mx-auto text-[var(--misty-text-subtle)]"/>}<h3 className="mb-1 mt-3 text-base">No {props.kind} yet</h3><p className="m-0 mb-4 max-w-md text-xs leading-relaxed text-[var(--misty-text-subtle)]">{description}</p><button className={primaryButtonClass} type="button" onClick={createNew}><Plus size={15}/>Create one</button></div></div> : <div className="mx-auto grid max-w-3xl gap-5">
          <div><h2 className="m-0 text-lg">{draft.id ? `Edit ${props.kind === "agents" ? "Agent" : "Workflow"}` : `New ${props.kind === "agents" ? "Agent" : "Workflow"}`}</h2><p className="m-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{description}</p></div>
          {props.error ? <p className="m-0 rounded-lg border border-red-400/20 bg-red-950/20 p-3 text-xs text-red-200">{props.error}</p> : null}
          <label className={fieldLabelClass}>Name<input className={inputClass} maxLength={80} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
          {props.kind === "agents" ? <><div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3"><label className={fieldLabelClass}>Description<input className={inputClass} maxLength={240} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><label className={fieldLabelClass}>Icon<input className={inputClass} maxLength={40} value={draft.icon ?? "bot"} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}/></label></div><label className={fieldLabelClass}>Instructions<textarea className={`${inputClass} min-h-36 resize-y py-3`} value={draft.instructions ?? ""} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}/></label></> : <label className={fieldLabelClass}>Portable workflow package definition<textarea className={`${inputClass} min-h-72 resize-y py-3 font-mono text-[11px]`} value={definitionText} onChange={(event) => { try { setDraft({ ...draft, definition: JSON.parse(event.target.value) as Record<string, unknown> }); } catch { /* retain last valid JSON */ } }}/><span>Include a structured metadata object with capabilities, typed inputs/outputs, integrations, permissions, runtime compatibility, and tags. Local-path and device-secret nodes are rejected by the server.</span></label>}
          <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.enabled ?? false} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}/>Enabled</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.schedules_enabled ?? false} onChange={(event) => setDraft({ ...draft, schedules_enabled: event.target.checked })}/>Scheduled runs</label><span className="text-[10px] text-[var(--misty-text-subtle)]">Manual runs charge the runner; scheduled runs charge the creator.</span></div>
          {props.kind === "agents" && draft.id ? <AgentArchitecturePanel agent={draft as SpaceStudioResource} workflows={props.workflows} onAgentUpdated={(agent) => setDraft(agent)}/> : null}
          {lastRun ? <pre className={`m-0 max-h-48 overflow-auto rounded-xl border p-3 text-[11px] ${lastRun.state === "completed" ? "border-emerald-400/20 bg-emerald-950/10 text-emerald-100" : "border-red-400/20 bg-red-950/10 text-red-100"}`}>{JSON.stringify(lastRun.result, null, 2)}</pre> : null}
          <div className="flex justify-between border-t border-[var(--misty-border-soft)] pt-4">{draft.id ? <button className={dangerButtonClass} type="button" onClick={() => window.confirm(`Delete “${draft.name}”?`) && void props.deleteStudio(props.spaceId, props.kind, draft.id!).then(() => { setSelectedId(null); setDraft(null); })}><Trash2 size={14}/>Delete</button> : <span/>}<div className="flex gap-2">{props.kind === "workflows" && draft.id && draft.enabled ? <button className={secondaryButtonClass} disabled={running} type="button" onClick={() => void run()}><Play size={14}/>{running ? "Running…" : "Run"}</button> : null}<button className={primaryButtonClass} type="button" onClick={() => void save()}><Save size={14}/>Save</button></div></div>
        </div>}
      </section>
    </div>
  );
}

function studioTabClass({ isActive }: { isActive: boolean }) { return `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs no-underline ${isActive ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "text-[var(--misty-text-muted)]"}`; }
const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)] disabled:opacity-50";
const dangerButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 text-xs text-red-200";
const fieldLabelClass = "grid gap-2 text-xs font-medium text-[var(--misty-text-muted)] [&>span]:text-[10px] [&>span]:font-normal [&>span]:text-[var(--misty-text-subtle)]";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
const emptyStudioResources: SpaceStudioResource[] = [];
