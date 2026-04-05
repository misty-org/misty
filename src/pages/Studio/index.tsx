import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, History, Play, Plus, Save, Trash2, Workflow } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSpacesStore } from "../../stores/useSpacesStore";
import type { RunAction, RunApproval, SpaceRun, SpaceStudioResource, WorkflowVersion } from "../../spaces/types";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import { errorText } from "../../shared/format";
import { confirmAction } from "../../shared/confirmAction";
import { AgentArchitecturePanel, RunDetailDialog } from "./AgentArchitecturePanel";
import { UnifiedWorkflowEditor } from "./UnifiedWorkflowEditor";

export type SpaceStudioKind = "agents" | "workflows";

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
  const canView = space?.permissions?.["studio.view"] !== false;
  const canManage = space?.permissions?.["studio.manage"] !== false;
  const canRun = space?.permissions?.["agents.run"] !== false;
  const resources = kind === "agents"
    ? agentsBySpace[spaceId] ?? emptyStudioResources
    : kind === "workflows"
      ? workflowsBySpace[spaceId] ?? emptyStudioResources
      : emptyStudioResources;

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (canView) void loadStudio(spaceId, kind); }, [canView, kind, loadStudio, spaceId]);
  useEffect(() => { if (canView && kind === "agents") void loadStudio(spaceId, "workflows"); }, [canView, kind, loadStudio, spaceId]);

  return (
    <div className="h-full min-h-0 bg-transparent">
      <main className="h-full min-h-0">
        {!canView
          ? <div className="grid h-full place-items-center p-8 text-center"><div><h2 className="m-0 text-base">Studio access is turned off</h2><p className="mb-0 mt-2 max-w-md text-xs leading-relaxed text-[var(--misty-text-subtle)]">Ask the Space owner to grant you permission to view Studio.</p></div></div>
          : kind === "workflows"
          ? <UnifiedWorkflowEditor spaceId={spaceId} canManage={canManage} />
          : <SharedStudio kind={kind} spaceId={spaceId} spaceName={space?.name ?? "This Space"} resources={resources} workflows={workflowsBySpace[spaceId] ?? emptyStudioResources} initialResourceId={searchParams.get(kind === "agents" ? "agentId" : "workflowId") ?? undefined} initialRunId={searchParams.get("runId") ?? undefined} error={error} canManage={canManage} canRun={canRun} saveStudio={saveStudio} deleteStudio={deleteStudio} runStudio={runStudio} />}
      </main>
    </div>
  );
}

function SharedStudio(props: {
  kind: "agents" | "workflows";
  spaceId: string;
  spaceName: string;
  resources: SpaceStudioResource[];
  workflows: SpaceStudioResource[];
  initialResourceId?: string;
  initialRunId?: string;
  error: string | null;
  canManage: boolean;
  canRun: boolean;
  saveStudio: ReturnType<typeof useSpacesStore.getState>["saveStudio"];
  deleteStudio: ReturnType<typeof useSpacesStore.getState>["deleteStudio"];
  runStudio: ReturnType<typeof useSpacesStore.getState>["runStudio"];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.initialResourceId ?? null);
  const [draft, setDraft] = useState<Partial<SpaceStudioResource> | null>(null);
  const [lastRun, setLastRun] = useState<SpaceRun | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workflowCapability, setWorkflowCapability] = useState("");
  const [workflowPrompt, setWorkflowPrompt] = useState("");
  const [definitionSource, setDefinitionSource] = useState("{}");
  const [definitionError, setDefinitionError] = useState("");
  const [workflowVersions, setWorkflowVersions] = useState<WorkflowVersion[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<SpaceRun[]>([]);
  const [workflowRunDetail, setWorkflowRunDetail] = useState<{ run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null>(null);
  const [workflowHistoryBusy, setWorkflowHistoryBusy] = useState(false);
  const [workflowHistoryError, setWorkflowHistoryError] = useState("");
  const appliedInitialResourceId = useRef("");
  const openedInitialRunId = useRef("");
  const workflowRunButtonRef = useRef<HTMLButtonElement>(null);
  const workflowRunReturnFocusRef = useRef<HTMLElement | null>(null);
  const selected = creating ? null : props.resources.find((item) => item.id === selectedId) ?? props.resources[0] ?? null;

  const refreshWorkflowHistory = async (workflowId = draft?.id) => {
    if (props.kind !== "workflows" || !workflowId) {
      setWorkflowVersions([]);
      setWorkflowRuns([]);
      return;
    }
    setWorkflowHistoryBusy(true);
    setWorkflowHistoryError("");
    try {
      const { versions } = await agentArchitectureApi.workflowVersions(props.spaceId, workflowId);
      setWorkflowVersions(versions);
      setWorkflowRuns([]);
    } catch (reason) {
      setWorkflowHistoryError(errorText(reason));
    } finally {
      setWorkflowHistoryBusy(false);
    }
  };

  const openWorkflowRun = async (runId: string, returnFocus?: HTMLElement | null) => {
    if (returnFocus) workflowRunReturnFocusRef.current = returnFocus;
    setWorkflowHistoryBusy(true);
    setWorkflowHistoryError("");
    try { setWorkflowRunDetail(await agentArchitectureApi.runDetail(runId)); }
    catch (reason) { setWorkflowHistoryError(errorText(reason)); }
    finally { setWorkflowHistoryBusy(false); }
  };

  useEffect(() => {
    if (creating) return;
    if (selected) {
      const next = props.kind === "workflows" ? workflowDraft(selected) : selected;
      setDraft(next);
      if (props.kind === "workflows") setDefinitionSource(JSON.stringify(next.definition ?? {}, null, 2));
    } else {
      setDraft(null);
      setDefinitionSource("{}");
    }
    setDefinitionError("");
    setWorkflowPrompt("");
  }, [creating, props.kind, props.spaceId, selected?.id, selected?.version]);
  useEffect(() => { setCreating(false); }, [props.kind, props.spaceId]);
  useEffect(() => {
    if (props.initialResourceId && appliedInitialResourceId.current !== props.initialResourceId && props.resources.some((item) => item.id === props.initialResourceId)) {
      appliedInitialResourceId.current = props.initialResourceId;
      setCreating(false);
      setSelectedId(props.initialResourceId);
    }
  }, [props.initialResourceId, props.resources]);
  useEffect(() => {
    if (props.kind !== "workflows" || !draft?.id) {
      setWorkflowVersions([]);
      setWorkflowRuns([]);
      setWorkflowRunDetail(null);
      return;
    }
    void refreshWorkflowHistory(draft.id);
  }, [draft?.id, props.kind, props.spaceId]);
  useEffect(() => {
    if (props.kind !== "workflows" || !props.initialRunId || openedInitialRunId.current === props.initialRunId) return;
    openedInitialRunId.current = props.initialRunId;
    void openWorkflowRun(props.initialRunId);
  }, [props.initialRunId, props.kind]);

  const title = props.kind === "agents" ? "Space Agents" : "Space Workflows";
  const agentRuntime = props.kind === "agents" ? draft?.runtime_kind ?? "cloud" : "";
  const workflowRuntime = props.kind === "workflows" ? studioWorkflowRuntime(draft) : "";
  const workflowDirectRunAvailable = props.kind === "workflows" && workflowRuntime === "misty-cloud";
  const description = props.kind === "agents"
    ? agentRuntime === "device"
      ? "Device Agents run on a paired computer. Manage their folders and triggers directly below."
      : "Cloud Agents can answer @mentions, use Space chat, and read only files explicitly attached to a run."
    : workflowRuntime === "misty-device"
      ? "Device Workflows run through an Agent with an attached local folder, keeping file access on its trusted device."
      : "Cloud Workflows stay available without a member device and reject local filesystem nodes.";
  const workflowCapabilities = useMemo(() => workflowCapabilityOptions(draft?.definition), [draft?.definition]);
  const workflowPromptRequired = useMemo(() => workflowCapabilityRequiresPrompt(draft?.definition, workflowCapability), [draft?.definition, workflowCapability]);

  useEffect(() => {
    setWorkflowCapability((current) => workflowCapabilities.some((item) => item.id === current) ? current : workflowCapabilities[0]?.id ?? "");
  }, [workflowCapabilities]);

  const createNew = () => {
    const fresh: Partial<SpaceStudioResource> = props.kind === "agents"
      ? { kind: "agent", name: "New Agent", description: "A capable teammate for this Space.", icon: "bot", instructions: "Help teammates in this Space.", access_policy: { mode: "space", allowedUserIds: [] }, enabled: true, status: "available", runtime_kind: "cloud", schedules_enabled: false, version: 0 }
      : { kind: "workflow", name: "New Workflow", description: "A reusable workflow for this Space.", definition: starterWorkflowDefinition(), enabled: false, schedules_enabled: false, version: 0 };
    setCreating(true); setSelectedId(null); setDraft(fresh); setDefinitionError(""); setWorkflowPrompt("");
    if (props.kind === "workflows") setDefinitionSource(JSON.stringify(fresh.definition, null, 2));
  };

  const save = async () => {
    if (!draft?.name?.trim() || saving || (props.kind === "workflows" && definitionError)) return;
    setSaving(true);
    try {
      const saved = await props.saveStudio(props.spaceId, props.kind, { ...draft, schedules_enabled: false });
      const next = props.kind === "workflows" ? workflowDraft(saved) : saved;
      setCreating(false); setSelectedId(saved.id); setDraft(next);
      if (props.kind === "workflows") {
        setDefinitionSource(JSON.stringify(next.definition ?? {}, null, 2));
        await refreshWorkflowHistory(saved.id);
      }
    } catch { /* server conflict is shown by the shared store */ }
    finally { setSaving(false); }
  };

  const run = async () => {
    if (!draft?.id || workflowPromptRequired && !workflowPrompt.trim()) return;
    setRunning(true); setLastRun(null); setWorkflowHistoryError("");
    try {
      const next = await props.runStudio(props.spaceId, props.kind, draft.id, workflowPrompt.trim(), workflowCapability);
      setLastRun(next);
      if (props.kind === "workflows") {
        await refreshWorkflowHistory(draft.id);
        await openWorkflowRun(next.id, workflowRunButtonRef.current);
      }
    } catch (reason) { setWorkflowHistoryError(errorText(reason)); }
    finally { setRunning(false); }
  };

  const decideWorkflowRun = async (approved: boolean) => {
    if (!workflowRunDetail) return;
    setWorkflowHistoryBusy(true); setWorkflowHistoryError("");
    try {
      await agentArchitectureApi.decideRun(workflowRunDetail.run.id, approved);
      await Promise.all([openWorkflowRun(workflowRunDetail.run.id), refreshWorkflowHistory(draft?.id)]);
    } catch (reason) { setWorkflowHistoryError(errorText(reason)); }
    finally { setWorkflowHistoryBusy(false); }
  };

  const cancelWorkflowRun = async () => {
    if (!workflowRunDetail) return;
    setWorkflowHistoryBusy(true); setWorkflowHistoryError("");
    try {
      await agentArchitectureApi.cancelRun(workflowRunDetail.run.id);
      await Promise.all([openWorkflowRun(workflowRunDetail.run.id), refreshWorkflowHistory(draft?.id)]);
    } catch (reason) { setWorkflowHistoryError(errorText(reason)); }
    finally { setWorkflowHistoryBusy(false); }
  };

  const retryWorkflowRun = async () => {
    if (!workflowRunDetail) return;
    setWorkflowHistoryBusy(true); setWorkflowHistoryError("");
    try {
      const next = await agentArchitectureApi.retryRun(workflowRunDetail.run.id);
      await Promise.all([openWorkflowRun(next.id), refreshWorkflowHistory(draft?.id)]);
    } catch (reason) { setWorkflowHistoryError(errorText(reason)); }
    finally { setWorkflowHistoryBusy(false); }
  };

  const remove = async () => {
    if (!draft?.id || !await confirmAction(`Delete “${draft.name}”?`)) return;
    try {
      await props.deleteStudio(props.spaceId, props.kind, draft.id);
      setCreating(false);
      setSelectedId(null);
      setDraft(null);
    } catch { /* server error is shown by the shared store */ }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[250px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto border-r border-[var(--misty-divider-subtle)] bg-transparent p-3">
        <div className="mb-3 px-2"><h2 className="m-0 text-sm font-semibold">{title}</h2><span className="text-[10px] text-[var(--misty-text-subtle)]">{props.canManage ? "Shared with every member" : "View only"}</span></div>
        <div className="grid gap-1">{props.resources.map((item) => <button className={`rounded-xl border-0 px-3 py-2.5 text-left ${!creating && selected?.id === item.id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`} type="button" key={item.id} onClick={() => { setCreating(false); setSelectedId(item.id); }}><span className="block truncate text-xs font-medium">{item.name}</span><span className="mt-1 block text-[9px] text-[var(--misty-text-subtle)]">{props.kind === "workflows" ? `${studioWorkflowRuntime(item) === "misty-device" ? "Device" : "Cloud"} · ` : `${item.runtime_kind === "device" ? "Device" : "Cloud"} · `}v{item.active_workflow?.version ?? item.version} · {item.enabled ? "Enabled" : "Disabled"}</span></button>)}{props.canManage ? <button className={addResourceRowClass} type="button" onClick={createNew}><Plus size={15}/><span>Add {props.kind === "agents" ? "agent" : "workflow"}</span></button> : null}</div>
      </aside>
      <section className="min-h-0 overflow-auto p-6">
        {!draft ? <div className="grid h-full place-items-center text-center"><div>{props.kind === "agents" ? <Bot className="mx-auto text-[var(--misty-text-subtle)]"/> : <Workflow className="mx-auto text-[var(--misty-text-subtle)]"/>}<h3 className="mb-1 mt-3 text-base">No {props.kind} yet</h3><p className="m-0 mb-4 max-w-md text-xs leading-relaxed text-[var(--misty-text-subtle)]">{description}</p>{props.canManage ? <button className={primaryButtonClass} type="button" onClick={createNew}><Plus size={15}/>Create one</button> : null}</div></div> : <div className="mx-auto grid max-w-3xl gap-5">
          <div><h2 className="m-0 text-lg">{draft.id ? `Edit ${props.kind === "agents" ? "Agent" : "Workflow"}` : `New ${props.kind === "agents" ? "Agent" : "Workflow"}`}</h2><p className="m-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{description}</p></div>
          {props.error ? <p className="m-0 rounded-lg border border-red-400/20 bg-red-950/20 p-3 text-xs text-red-200" role="alert">{props.error}</p> : null}
          {!props.canManage ? <p className="m-0 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 py-2 text-[10px] text-[var(--misty-text-subtle)]">You can view this resource, but only members with Studio management permission can change it.</p> : null}
          <label className={fieldLabelClass}>Name<input className={inputClass} disabled={!props.canManage} maxLength={80} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
          {props.kind === "agents" ? <><div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3"><label className={fieldLabelClass}>Description<input className={inputClass} disabled={!props.canManage} maxLength={240} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><label className={fieldLabelClass}>Icon<input className={inputClass} disabled={!props.canManage} maxLength={40} value={draft.icon ?? "bot"} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}/></label></div><label className={fieldLabelClass}>Instructions<textarea className={`${inputClass} min-h-36 resize-y py-3`} disabled={!props.canManage} value={draft.instructions ?? ""} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}/></label><div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3"><label className={fieldLabelClass}>Who can use this Agent?<select className={inputClass} disabled={!props.canManage} value={draft.access_policy?.mode ?? "space"} onChange={(event) => setDraft({ ...draft, access_policy: { mode: event.target.value as "space" | "selected", allowedUserIds: event.target.value === "space" ? [] : draft.access_policy?.allowedUserIds ?? [] } })}><option value="space">Everyone in Space</option><option value="selected">Selected members</option></select></label>{draft.access_policy?.mode === "selected" ? <label className={fieldLabelClass}>Allowed member IDs<input className={inputClass} disabled={!props.canManage} value={draft.access_policy.allowedUserIds.join(", ")} placeholder="user-id, user-id" onChange={(event) => setDraft({ ...draft, access_policy: { mode: "selected", allowedUserIds: [...new Set(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))] } })}/><span>Only these Space members and the creator can use this Agent.</span></label> : <div className="self-end pb-2 text-[10px] text-[var(--misty-text-subtle)]">Default: every Space member can use the Agent with isolated conversations and run state.</div>}</div></> : <><label className={fieldLabelClass}>Description<input className={inputClass} disabled={!props.canManage} maxLength={240} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><label className={fieldLabelClass}>Portable workflow package definition<textarea className={`${inputClass} min-h-72 resize-y py-3 font-mono text-[11px] ${definitionError ? "border-red-400/60" : ""}`} disabled={!props.canManage} value={definitionSource} aria-invalid={Boolean(definitionError)} aria-describedby={definitionError ? "workflow-definition-error" : undefined} onChange={(event) => { const source = event.target.value; setDefinitionSource(source); try { const value = JSON.parse(source) as unknown; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object"); setDraft({ ...draft, definition: value as Record<string, unknown> }); setDefinitionError(""); } catch { setDefinitionError("Enter a valid JSON object before saving."); } }}/><span>Include structured capabilities, typed inputs and outputs, integrations, permissions, runtime compatibility, and tags. Local-path and device-secret nodes are rejected by the server.</span>{definitionError ? <span className="text-red-300" id="workflow-definition-error" role="alert">{definitionError}</span> : null}</label></>}
          <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!props.canManage} checked={draft.enabled ?? false} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}/>Enabled</label><span className="text-[10px] text-[var(--misty-text-subtle)]">Runs charge the member who starts them.</span></div>
          {props.kind === "workflows" && workflowRuntime === "misty-device" ? <p className="m-0 rounded-xl border border-sky-400/20 bg-sky-950/15 p-3 text-xs leading-relaxed text-sky-100">This Workflow requires local device capabilities. Attach a folder to an Agent, then pin this version to that Agent to test or run it.</p> : null}
          {props.kind === "agents" && draft.id ? <AgentArchitecturePanel agent={draft as SpaceStudioResource} spaceName={props.spaceName} workflows={props.workflows} canManage={props.canManage} canRun={props.canRun} initialRunId={props.initialRunId} onAgentUpdated={(agent) => setDraft(agent)}/> : null}
          {lastRun ? <button className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-[11px] ${lastRun.state === "completed" ? "border-emerald-400/20 bg-emerald-950/10 text-emerald-100" : lastRun.state === "awaiting_approval" ? "border-amber-400/20 bg-amber-950/10 text-amber-100" : "border-red-400/20 bg-red-950/10 text-red-100"}`} type="button" onClick={(event) => void openWorkflowRun(lastRun.id, event.currentTarget)}><span>Latest run · {lastRun.state.replace(/_/g, " ")}</span><span>Inspect run</span></button> : null}
          {workflowHistoryError ? <p className="m-0 rounded-lg border border-red-400/20 bg-red-950/20 p-3 text-xs text-red-200" role="alert">{workflowHistoryError}</p> : null}
          {props.kind === "workflows" && draft.id ? <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4"><div className="flex items-center justify-between gap-3"><h3 className="m-0 text-xs font-semibold">Version history</h3><span className="text-[9px] text-[var(--misty-text-subtle)]">{workflowVersions.length} pinned snapshot{workflowVersions.length === 1 ? "" : "s"}</span></div><div className="mt-3 grid max-h-48 gap-1 overflow-auto">{workflowVersions.length ? workflowVersions.map((version) => <article className="rounded-lg bg-[var(--misty-surface-2)] px-3 py-2" key={version.id}><p className="m-0 text-[10px] font-medium">{version.version}</p><p className="mb-0 mt-1 truncate text-[9px] text-[var(--misty-text-subtle)]">{version.author_name} · {new Date(version.created_at).toLocaleString()}</p></article>) : <p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">{workflowHistoryBusy ? "Loading versions…" : "No versions available."}</p>}</div></section><section className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4"><div className="flex items-center justify-between gap-3"><h3 className="m-0 text-xs font-semibold">Run history</h3><button className={smallButtonClass} type="button" disabled={workflowHistoryBusy} onClick={() => void refreshWorkflowHistory(draft.id)}><History size={12}/>{workflowHistoryBusy ? "Refreshing…" : "Refresh"}</button></div><div className="mt-3 grid max-h-48 gap-1 overflow-auto">{workflowRuns.length ? workflowRuns.map((item) => <button className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-2 rounded-lg border-0 bg-[var(--misty-surface-2)] px-3 py-2 text-left" type="button" key={item.id} onClick={(event) => void openWorkflowRun(item.id, event.currentTarget)}><span className="text-[9px] capitalize">{item.state.replace(/_/g, " ")}</span><span className="truncate text-[9px] text-[var(--misty-text-subtle)]">{item.capability_id} · {item.workflow_version}</span></button>) : <p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">{workflowHistoryBusy ? "Loading runs…" : "No runs yet."}</p>}</div></section></div> : null}
          <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--misty-border-soft)] pt-4">{props.canManage && draft.id ? <button className={dangerButtonClass} type="button" onClick={() => void remove()}><Trash2 size={14}/>Delete</button> : <span/>}<div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled && workflowCapabilities.length > 1 ? <select className={`${inputClass} max-w-48`} value={workflowCapability} onChange={(event) => setWorkflowCapability(event.target.value)} aria-label="Workflow test capability">{workflowCapabilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : null}{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled ? <input className={`${inputClass} min-w-48 flex-1`} value={workflowPrompt} onChange={(event) => setWorkflowPrompt(event.target.value)} placeholder={workflowPromptRequired ? "Test input (required)…" : "Test input…"} aria-label="Workflow test input"/> : null}{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled ? <button ref={workflowRunButtonRef} className={secondaryButtonClass} disabled={running || workflowCapabilities.length > 1 && !workflowCapability || workflowPromptRequired && !workflowPrompt.trim()} type="button" onClick={() => void run()}><Play size={14}/>{running ? "Running…" : "Run"}</button> : null}{props.canManage ? <button className={primaryButtonClass} disabled={saving || !draft.name?.trim() || Boolean(definitionError)} type="button" onClick={() => void save()}><Save size={14}/>{saving ? "Saving…" : "Save"}</button> : null}</div></div>
        </div>}
        {workflowRunDetail ? <RunDetailDialog detail={workflowRunDetail} resourceName={draft?.name ?? "Workflow"} spaceName={props.spaceName} busy={workflowHistoryBusy} canRetry={workflowDirectRunAvailable && Boolean(draft?.enabled) && props.canRun} operationError={workflowHistoryError} returnFocusRef={workflowRunReturnFocusRef} onClose={() => setWorkflowRunDetail(null)} onDecide={decideWorkflowRun} onCancel={cancelWorkflowRun} onRetry={retryWorkflowRun}/> : null}
      </section>
    </div>
  );
}

function workflowCapabilityOptions(definition: Record<string, unknown> | undefined): Array<{ id: string; name: string }> {
  const metadata = definition?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const capabilities = (metadata as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return [];
  return capabilities.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as { id?: unknown; name?: unknown };
    return typeof candidate.id === "string" && candidate.id ? [{ id: candidate.id, name: typeof candidate.name === "string" && candidate.name ? candidate.name : candidate.id }] : [];
  });
}

function workflowCapabilityRequiresPrompt(definition: Record<string, unknown> | undefined, capabilityId: string): boolean {
  const metadata = definition?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const capabilities = (metadata as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return false;
  const capability = capabilities.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { id?: unknown }).id === capabilityId);
  if (!capability || typeof capability !== "object" || Array.isArray(capability)) return false;
  const inputs = (capability as { inputs?: unknown }).inputs;
  return Array.isArray(inputs) && inputs.some((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { name?: unknown; type?: unknown; required?: unknown }).name === "prompt" && (item as { type?: unknown }).type === "string" && (item as { required?: unknown }).required === true);
}

function workflowDraft(resource: SpaceStudioResource): SpaceStudioResource {
  const definition = resource.definition && typeof resource.definition === "object" && !Array.isArray(resource.definition)
    ? { ...resource.definition }
    : {};
  if (!("metadata" in definition) && resource.active_workflow?.metadata) definition.metadata = resource.active_workflow.metadata;
  return { ...resource, definition };
}

function studioWorkflowRuntime(resource: Partial<SpaceStudioResource> | null | undefined): string {
  const active = resource?.active_workflow?.metadata.runtime.kind;
  if (active) return active;
  const metadata = resource?.definition?.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const runtime = (metadata as { runtime?: unknown }).runtime;
    if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) {
      const kind = (runtime as { kind?: unknown }).kind;
      if (typeof kind === "string") return kind;
    }
  }
  return "misty-cloud";
}

function starterWorkflowDefinition(): Record<string, unknown> {
  return {
    metadata: {
      capabilities: [{ id: "default", name: "Run workflow", description: "Run this workflow with a text prompt.", inputs: [{ name: "prompt", type: "string", required: true }], outputs: [{ name: "result", type: "object" }], readOnly: true, destructive: false, confirmationRequired: false, tags: ["general"] }],
      requiredIntegrations: [], requiredPermissions: [], runtime: { kind: "misty-cloud", compatibility: "1" }, tags: ["general"],
    },
    nodes: [{ id: "result", kind: "transform", config: { prefix: "" } }],
    edges: [],
  };
}

const addResourceRowClass = "mt-1 inline-flex min-h-10 w-full items-center gap-2 rounded-xl border border-dashed border-[var(--misty-border-strong)] bg-transparent px-2.5 text-left text-xs font-medium text-[var(--misty-text-muted)] transition-colors hover:border-white/30 hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]";
const smallButtonClass = "inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 text-[9px] disabled:opacity-50";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)] disabled:opacity-50";
const dangerButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 text-xs text-red-200";
const fieldLabelClass = "grid gap-2 text-xs font-medium text-[var(--misty-text-muted)] [&>span]:text-[10px] [&>span]:font-normal [&>span]:text-[var(--misty-text-subtle)]";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
const emptyStudioResources: SpaceStudioResource[] = [];
