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
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { EmptyState, PermissionState, StatusBadge } from "../../components/misty";

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
          ? <PermissionState className="h-full" title="Studio access is turned off" description="Ask the Space owner to grant you permission to view Studio."/>
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
      <aside className="min-h-0 overflow-auto border-r border-border bg-card p-3">
        <div className="mb-3 flex items-center gap-2 px-2"><h2 className="m-0 text-sm font-semibold">{title}</h2>{!props.canManage ? <Badge className="text-[9px]" variant="secondary">View only</Badge> : null}</div>
        <div className="grid gap-1">{props.resources.map((item) => <Button className={`h-auto justify-start rounded-md px-3 py-2.5 text-left ${!creating && selected?.id === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`} variant="ghost" key={item.id} onClick={() => { setCreating(false); setSelectedId(item.id); }}><span className="min-w-0"><span className="block truncate text-xs font-medium">{item.name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{props.kind === "workflows" ? `${studioWorkflowRuntime(item) === "misty-device" ? "Device" : "Cloud"} · ` : `${item.runtime_kind === "device" ? "Device" : "Cloud"} · `}v{item.active_workflow?.version ?? item.version} · {item.enabled ? "Enabled" : "Disabled"}</span></span></Button>)}{props.canManage ? <Button className="mt-1 w-full justify-start border-dashed text-muted-foreground" variant="outline" size="sm" onClick={createNew}><Plus/><span>Add {props.kind === "agents" ? "agent" : "workflow"}</span></Button> : null}</div>
      </aside>
      <section className="min-h-0 overflow-auto p-6">
        {!draft ? <EmptyState className="h-full" icon={props.kind === "agents" ? <Bot/> : <Workflow/>} title={`No ${props.kind} yet`} description={props.canManage ? `Create the first ${props.kind === "agents" ? "Agent" : "Workflow"} for this Space.` : "A Studio manager can add one here."} action={props.canManage ? <Button onClick={createNew}><Plus/>Create one</Button> : undefined}/> : <div className="mx-auto grid max-w-3xl gap-5">
          <div><h2 className="text-lg font-semibold">{draft.id ? `Edit ${props.kind === "agents" ? "Agent" : "Workflow"}` : `New ${props.kind === "agents" ? "Agent" : "Workflow"}`}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
          {props.error ? <Alert variant="destructive"><AlertTitle>Studio couldn’t save this resource</AlertTitle><AlertDescription>{props.error}</AlertDescription></Alert> : null}
          {!props.canManage ? <Alert><AlertTitle>View-only access</AlertTitle><AlertDescription>You can view this resource, but only members with Studio management permission can change it.</AlertDescription></Alert> : null}
          <label className={fieldLabelClass}>Name<Input disabled={!props.canManage} maxLength={80} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
          {props.kind === "agents" ? <><div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3"><label className={fieldLabelClass}>Description<Input disabled={!props.canManage} maxLength={240} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><label className={fieldLabelClass}>Icon<Input disabled={!props.canManage} maxLength={40} value={draft.icon ?? "bot"} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}/></label></div><label className={fieldLabelClass}>Instructions<Textarea className="min-h-36 resize-y" disabled={!props.canManage} value={draft.instructions ?? ""} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}/></label><div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3"><label className={fieldLabelClass}>Who can use this Agent?<Select disabled={!props.canManage} value={draft.access_policy?.mode ?? "space"} onValueChange={(value) => setDraft({ ...draft, access_policy: { mode: value as "space" | "selected", allowedUserIds: value === "space" ? [] : draft.access_policy?.allowedUserIds ?? [] } })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="space">Everyone in Space</SelectItem><SelectItem value="selected">Selected members</SelectItem></SelectContent></Select></label>{draft.access_policy?.mode === "selected" ? <label className={fieldLabelClass}>Allowed member IDs<Input disabled={!props.canManage} value={draft.access_policy.allowedUserIds.join(", ")} placeholder="user-id, user-id" onChange={(event) => setDraft({ ...draft, access_policy: { mode: "selected", allowedUserIds: [...new Set(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))] } })}/><span>Only these Space members and the creator can use this Agent.</span></label> : <div className="self-end pb-2 text-[10px] text-muted-foreground">Default: every Space member can use the Agent with isolated conversations and run state.</div>}</div></> : <><label className={fieldLabelClass}>Description<Input disabled={!props.canManage} maxLength={240} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><label className={fieldLabelClass}>Portable workflow package definition<Textarea className={`min-h-72 resize-y font-mono text-[11px] ${definitionError ? "border-destructive" : ""}`} disabled={!props.canManage} value={definitionSource} aria-invalid={Boolean(definitionError)} aria-describedby={definitionError ? "workflow-definition-error" : undefined} onChange={(event) => { const source = event.target.value; setDefinitionSource(source); try { const value = JSON.parse(source) as unknown; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object"); setDraft({ ...draft, definition: value as Record<string, unknown> }); setDefinitionError(""); } catch { setDefinitionError("Enter a valid JSON object before saving."); } }}/><span>Include structured capabilities, typed inputs and outputs, integrations, permissions, runtime compatibility, and tags. Local-path and device-secret nodes are rejected by the server.</span>{definitionError ? <span className="text-destructive" id="workflow-definition-error" role="alert">{definitionError}</span> : null}</label></>}
          <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs"><Checkbox disabled={!props.canManage} checked={draft.enabled ?? false} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked === true })}/>Enabled</label><span className="text-[10px] text-muted-foreground">Runs charge the member who starts them.</span></div>
          {props.kind === "workflows" && workflowRuntime === "misty-device" ? <Alert><AlertTitle>Device runtime required</AlertTitle><AlertDescription>This Workflow requires local device capabilities. Attach a folder to an Agent, then pin this version to that Agent to test or run it.</AlertDescription></Alert> : null}
          {props.kind === "agents" && draft.id ? <AgentArchitecturePanel agent={draft as SpaceStudioResource} spaceName={props.spaceName} workflows={props.workflows} canManage={props.canManage} canRun={props.canRun} initialRunId={props.initialRunId} onAgentUpdated={(agent) => setDraft(agent)}/> : null}
          {lastRun ? <Button className="h-auto w-full justify-between rounded-md p-3 text-left text-xs shadow-none" variant="outline" onClick={(event) => void openWorkflowRun(lastRun.id, event.currentTarget)}><StatusBadge status={runStatus(lastRun.state)} dot className="capitalize">Latest run · {lastRun.state.replace(/_/g, " ")}</StatusBadge><span>Inspect run</span></Button> : null}
          {workflowHistoryError ? <Alert variant="destructive"><AlertTitle>Workflow history error</AlertTitle><AlertDescription>{workflowHistoryError}</AlertDescription></Alert> : null}
          {props.kind === "workflows" && draft.id ? <Card className="grid overflow-hidden shadow-none lg:grid-cols-2 lg:divide-x lg:divide-border"><section className="border-b border-border p-4 lg:border-b-0"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">Version history</h3><span className="text-[10px] text-muted-foreground">{workflowVersions.length} pinned snapshot{workflowVersions.length === 1 ? "" : "s"}</span></div><div className="mt-3 grid max-h-48 gap-1 overflow-auto">{workflowVersions.length ? workflowVersions.map((version) => <article className="rounded-md bg-muted/40 px-3 py-2" key={version.id}><p className="text-xs font-medium">{version.version}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{version.author_name} · {new Date(version.created_at).toLocaleString()}</p></article>) : <p className="text-xs text-muted-foreground">{workflowHistoryBusy ? "Loading versions…" : "No versions available."}</p>}</div></section><section className="p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">Run history</h3><Button size="sm" variant="ghost" disabled={workflowHistoryBusy} onClick={() => void refreshWorkflowHistory(draft.id)}><History/>{workflowHistoryBusy ? "Refreshing…" : "Refresh"}</Button></div><div className="mt-3 grid max-h-48 gap-1 overflow-auto">{workflowRuns.length ? workflowRuns.map((item) => <Button className="grid h-auto grid-cols-[auto_minmax(0,1fr)] justify-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-left" variant="ghost" key={item.id} onClick={(event) => void openWorkflowRun(item.id, event.currentTarget)}><StatusBadge status={runStatus(item.state)} className="capitalize">{item.state.replace(/_/g, " ")}</StatusBadge><span className="truncate text-xs text-muted-foreground">{item.capability_id} · {item.workflow_version}</span></Button>) : <p className="text-xs text-muted-foreground">{workflowHistoryBusy ? "Loading runs…" : "No runs yet."}</p>}</div></section></Card> : null}
          <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">{props.canManage && draft.id ? <Button variant="destructive" onClick={() => void remove()}><Trash2 size={14}/>Delete</Button> : <span/>}<div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled && workflowCapabilities.length > 1 ? <Select value={workflowCapability} onValueChange={setWorkflowCapability}><SelectTrigger className="max-w-48" aria-label="Workflow test capability"><SelectValue/></SelectTrigger><SelectContent>{workflowCapabilities.map((item) => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select> : null}{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled ? <Input className="min-w-48 flex-1" value={workflowPrompt} onChange={(event) => setWorkflowPrompt(event.target.value)} placeholder={workflowPromptRequired ? "Test input (required)…" : "Test input…"} aria-label="Workflow test input"/> : null}{workflowDirectRunAvailable && props.canRun && draft.id && draft.enabled ? <Button ref={workflowRunButtonRef} variant="outline" disabled={running || workflowCapabilities.length > 1 && !workflowCapability || workflowPromptRequired && !workflowPrompt.trim()} onClick={() => void run()}><Play size={14}/>{running ? "Running…" : "Run"}</Button> : null}{props.canManage ? <Button disabled={saving || !draft.name?.trim() || Boolean(definitionError)} onClick={() => void save()}><Save size={14}/>{saving ? "Saving…" : "Save"}</Button> : null}</div></div>
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

function runStatus(state: string): "neutral" | "info" | "success" | "warning" | "danger" { if (state === "completed") return "success"; if (state === "completed_with_errors" || state === "cooldown" || state === "awaiting_approval") return "warning"; if (state === "failed" || state === "rejected" || state === "canceled") return "danger"; if (state === "running" || state === "queued") return "info"; return "neutral"; }
const fieldLabelClass = "grid gap-2 text-xs font-medium text-foreground [&>span]:text-[11px] [&>span]:font-normal [&>span]:text-muted-foreground";
const emptyStudioResources: SpaceStudioResource[] = [];
