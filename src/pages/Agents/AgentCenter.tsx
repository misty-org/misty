import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Bot, CalendarClock, Check, ChevronRight, CircleStop, Clock3, ExternalLink,
  FileText, History, Inbox, LoaderCircle, LockKeyhole, Plug, RefreshCcw, Search, Settings2,
  ShieldCheck, Sparkles, Unplug, Workflow, X,
} from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import { SpaceRequestError, spacesApi } from "../../spaces/api";
import type { AgentCatalogEntry, AgentInstanceRecord, AvailableProviderResource, ProviderConnectionAvailability, ProviderSharedResource, RunAction, RunApproval, SpaceCalendarSource, SpaceIntegration, SpaceRun, WorkflowRunStep } from "../../spaces/types";
import { errorText } from "../../shared/format";
import { openProviderAuthorizationLink } from "../../shared/openExternalLink";
import { providerCatalog, providerById } from "../../workflows/providers";
import SpaceStudioPage, { type SpaceStudioKind } from "../Studio";

type AgentCenterTab = "attention" | "results" | "activity" | "history" | "settings" | "studio";
type AgentRuntime = { catalog: AgentCatalogEntry; instance?: AgentInstanceRecord; runs: SpaceRun[] };
type RunDetail = { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[]; steps: WorkflowRunStep[] };

export function AgentCenter({ spaceId, canRun, canViewStudio }: { spaceId: string; spaceName: string; canRun: boolean; canViewStudio: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentRuntime[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [providerAvailability, setProviderAvailability] = useState<ProviderConnectionAvailability[]>([]);
  const [sharedResources, setSharedResources] = useState<ProviderSharedResource[]>([]);
  const [calendarSources, setCalendarSources] = useState<SpaceCalendarSource[]>([]);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [selectedAgentId, setSelectedAgentId] = useState(() => searchParams.get("agentId") ?? "all");
  const [openedRunId, setOpenedRunId] = useState(() => searchParams.get("runId") ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const runReturnFocus = useRef<HTMLElement | null>(null);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const agentSegment = pathParts[pathParts.indexOf("agents") + 1] ?? "";
  const tab = normalizeAgentTab(agentSegment, canRun, canViewStudio);
  const studioKind: SpaceStudioKind = pathParts[pathParts.length - 1] === "workflows" ? "workflows" : "agents";
  useEffect(() => {
    if (agentSegment) return;
    navigate(`/spaces/${encodeURIComponent(spaceId)}/agents/${canRun ? "attention" : "studio/agents"}`, { replace: true });
  }, [agentSegment, canRun, navigate, spaceId]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [{ agents: catalog }, { integrations: connected, providers = [] }, shared, calendars] = await Promise.all([agentArchitectureApi.catalog(), agentArchitectureApi.integrations(spaceId), agentArchitectureApi.sharedProviderResources(spaceId), spacesApi.calendarSources(spaceId)]);
      const visible = catalog.filter((item) => item.space_id === spaceId);
      const runtime = await Promise.all(visible.map(async (item): Promise<AgentRuntime> => {
        const [instanceResult, runsResult] = await Promise.allSettled([agentArchitectureApi.agentInstance(spaceId, item.agent_id), agentArchitectureApi.runs(spaceId, item.agent_id)]);
        return { catalog: item, instance: instanceResult.status === "fulfilled" ? instanceResult.value : undefined, runs: runsResult.status === "fulfilled" ? runsResult.value.runs : [] };
      }));
      const attentionRuns = runtime.flatMap((item) => item.runs).filter((run) => run.state === "awaiting_approval" || run.state === "failed");
      const attentionDetails = await Promise.all(attentionRuns.map(async (run) => {
        try { return [run.id, await agentArchitectureApi.runDetail(run.id)] as const; }
        catch { return null; }
      }));
      setAgents(runtime); setIntegrations(connected); setProviderAvailability(providers); setSharedResources(shared.resources); setCalendarSources(calendars.sources); setDetails(Object.fromEntries(attentionDetails.filter(Boolean) as Array<readonly [string, RunDetail]>));
      if (selectedAgentId !== "all" && !runtime.some((item) => item.catalog.agent_id === selectedAgentId)) setSelectedAgentId("all");
    } catch (reason) { setError(errorText(reason)); } finally { setLoading(false); }
  }, [selectedAgentId, spaceId]);

  useEffect(() => { if (canRun) void load(); else setLoading(false); }, [canRun, load]);
  useEffect(() => {
    const refreshAfterAuthorization = () => {
      if (canRun && document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshAfterAuthorization);
    return () => window.removeEventListener("focus", refreshAfterAuthorization);
  }, [canRun, load]);
  const scopedAgents = selectedAgentId === "all" ? agents : agents.filter((item) => item.catalog.agent_id === selectedAgentId);
  const allRuns = useMemo(() => scopedAgents.flatMap((item) => item.runs.map((run) => ({ run, agent: item }))).sort((a, b) => b.run.created_at.localeCompare(a.run.created_at)), [scopedAgents]);
  const connectionAttention = integrations.filter((item) => item.status !== "active");
  const resourceAttention = sharedResources.filter((item) => item.status === "needs_attention");
  const calendarAttention = calendarSources.filter((item) => item.status === "needs_attention" || item.status === "disabled");
  const updateAttention = scopedAgents.filter((item) => item.instance?.update_available);
  const approvalAttention = allRuns.filter(({ run }) => run.state === "awaiting_approval");
  const failedAttention = allRuns.filter(({ run }) => run.state === "failed");
  const attentionCount = approvalAttention.length + failedAttention.length + connectionAttention.length + resourceAttention.length + calendarAttention.length + updateAttention.length;
  const results = allRuns.filter(({ run }) => run.state === "completed" || run.state === "completed_with_errors");
  const active = allRuns.filter(({ run }) => ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state));
  const openedDetail = openedRunId ? details[openedRunId] : undefined;

  const openRun = async (runId: string, trigger?: HTMLElement) => {
    if (trigger) runReturnFocus.current = trigger;
    setOpenedRunId(runId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("runId", runId);
    setSearchParams(nextParams, { replace: true });
    if (details[runId]) return;
    setBusy(runId);
    try { const detail = await agentArchitectureApi.runDetail(runId); setDetails((current) => ({ ...current, [runId]: detail })); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  useEffect(() => {
    const linkedRunId = searchParams.get("runId") ?? "";
    if (!linkedRunId || details[linkedRunId] || busy === linkedRunId) return;
    void openRun(linkedRunId);
  }, [busy, details, searchParams]);
  const decide = async (runId: string, approved: boolean) => {
    setBusy(runId);
    try { await agentArchitectureApi.decideRun(runId, approved); setOpenedRunId(""); await load(); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const cancel = async (runId: string) => {
    setBusy(runId); try { await agentArchitectureApi.cancelRun(runId); setOpenedRunId(""); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const retry = async (runId: string) => {
    setBusy(runId); try { await agentArchitectureApi.retryRun(runId); setOpenedRunId(""); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };

  const selectedAgentQuery = selectedAgentId !== "all" ? `?agentId=${encodeURIComponent(selectedAgentId)}` : "";
  const openTab = (next: AgentCenterTab) => navigate(next === "studio" ? `/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents${selectedAgentQuery}` : `/spaces/${encodeURIComponent(spaceId)}/agents/${next}${selectedAgentQuery}`);
  const tabs = tabDefinitions.filter((item) => item.id === "studio" ? canViewStudio : canRun);

  if (tab === "studio") return <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-page-bg,var(--misty-bg))]">
    <nav className="flex min-h-11 items-center gap-1 overflow-x-auto border-b border-[var(--misty-border-soft)] px-4" aria-label="Agent Center sections">{tabs.map((item) => <button key={item.id} className={tabButton(item.id === tab)} type="button" onClick={() => openTab(item.id)}><item.icon size={13}/>{item.label}{item.id === "attention" && attentionCount ? <span className="rounded-full bg-amber-400/15 px-1.5 text-[9px] text-amber-200">{attentionCount}</span> : null}</button>)}<span className="ml-auto flex rounded-lg bg-[var(--misty-surface-2)] p-0.5"><button className={studioSwitch(studioKind === "agents")} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents${searchParams.get("agentId") ? `?agentId=${encodeURIComponent(searchParams.get("agentId")!)}` : ""}`)}><Bot size={12}/>Agents</button><button className={studioSwitch(studioKind === "workflows")} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/agents/studio/workflows${searchParams.get("workflowId") ? `?workflowId=${encodeURIComponent(searchParams.get("workflowId")!)}` : ""}`)}><Workflow size={12}/>Workflows</button></span></nav>
    <div className="min-h-0"><SpaceStudioPage spaceId={spaceId} kind={studioKind}/></div>
  </main>;

  return <main className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] overflow-hidden">
    <aside className="min-h-0 overflow-auto border-r border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-3" aria-label="Agents">
      <div className="mb-2 flex min-h-9 items-center px-2"><strong className="truncate text-xs">Agents</strong><button className={`${iconButton} ml-auto`} type="button" onClick={() => void load()} aria-label="Refresh Agent Center"><RefreshCcw className={loading ? "animate-spin" : ""} size={14}/></button></div>
      <AgentRailRow active={selectedAgentId === "all"} name="All Agents" detail={`${agents.length} available`} attention={attentionCount} running={agents.reduce((total, item) => total + item.runs.filter((run) => ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state)).length, 0)} onClick={() => { setSelectedAgentId("all"); navigate(location.pathname, { replace: true }); }}/>
      <div className="my-2 border-t border-[var(--misty-border-soft)]"/>
      {agents.map((item) => <AgentRailRow key={item.catalog.agent_id} active={selectedAgentId === item.catalog.agent_id} name={item.catalog.agent_name} detail={item.instance?.status === "running" ? "Running" : "Idle"} attention={attentionForAgent(item, details, integrations)} running={item.runs.filter((run) => ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state)).length} onClick={() => { setSelectedAgentId(item.catalog.agent_id); navigate(`${location.pathname}?agentId=${encodeURIComponent(item.catalog.agent_id)}`, { replace: true }); }}/>) }
      {!loading && !agents.length ? <div className="px-3 py-8 text-center text-xs text-[var(--misty-text-subtle)]"><Bot className="mx-auto mb-2" size={24}/>No published Agents are available in this Space.</div> : null}
    </aside>
    <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-[var(--misty-app-page-bg,var(--misty-bg))]">
      <header className="flex min-h-11 items-center gap-3 border-b border-[var(--misty-border-soft)] px-4"><strong className="truncate text-xs">{selectedAgentId === "all" ? "All Agents" : scopedAgents[0]?.catalog.agent_name ?? "Agent"}</strong>{attentionCount ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-200">{attentionCount}</span> : null}{selectedAgentId !== "all" && scopedAgents[0] ? <button className={`${secondaryButton} ml-auto`} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/chat?agentId=${encodeURIComponent(selectedAgentId)}`)}><LockKeyhole size={13}/>Chat</button> : null}</header>
      <nav className="flex min-h-11 items-center gap-1 overflow-x-auto border-b border-[var(--misty-border-soft)] px-4" aria-label="Agent Center sections">{tabs.map((item) => <button key={item.id} className={tabButton(tab === item.id)} type="button" onClick={() => openTab(item.id)}><item.icon size={13}/>{item.label}{item.id === "attention" && attentionCount ? <span className="rounded-full bg-amber-400/15 px-1.5 text-[9px] text-amber-200">{attentionCount}</span> : null}</button>)}</nav>
      <div className="min-h-0 overflow-auto p-5">{error ? <button className="mb-4 w-full rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200" onClick={() => setError("")} type="button">{error}</button> : null}{loading ? <div className="grid h-full place-items-center text-xs text-[var(--misty-text-muted)]"><span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={16}/>Loading your Agent activity…</span></div> : tab === "attention" ? <AttentionView approvals={approvalAttention} failed={failedAttention} updates={updateAttention} integrations={connectionAttention} resources={resourceAttention} calendars={calendarAttention} details={details} busy={busy} canRun={canRun} onOpen={openRun} onDecide={decide} onRetry={retry}/> : tab === "results" ? <RunList title="Proactive results" empty="Completed workflow results will appear here." items={results} busy={busy} onOpen={openRun}/> : tab === "activity" ? <RunList title="Live activity" empty="No Agents are running right now." items={active} busy={busy} onOpen={openRun}/> : tab === "history" ? <HistoryView items={allRuns} query={query} setQuery={setQuery} busy={busy} onOpen={openRun}/> : <SettingsView spaceId={spaceId} agents={scopedAgents} integrations={integrations} providers={providerAvailability} busy={busy} setBusy={setBusy} onReload={load} setError={setError}/>}</div>
    </section>
    {openedRunId ? <AgentRunDrawer detail={openedDetail} loading={busy === openedRunId} canRun={canRun} busy={Boolean(busy)} onClose={() => { setOpenedRunId(""); const nextParams = new URLSearchParams(searchParams); nextParams.delete("runId"); setSearchParams(nextParams, { replace: true }); queueMicrotask(() => runReturnFocus.current?.focus()); }} onDecide={(approved) => void decide(openedRunId, approved)} onCancel={() => void cancel(openedRunId)} onRetry={() => void retry(openedRunId)}/> : null}
  </main>;
}

function AttentionView({ approvals, failed, updates, integrations, resources, calendars, details, busy, canRun, onOpen, onDecide, onRetry }: { approvals: Array<{ run: SpaceRun; agent: AgentRuntime }>; failed: Array<{ run: SpaceRun; agent: AgentRuntime }>; updates: AgentRuntime[]; integrations: SpaceIntegration[]; resources: ProviderSharedResource[]; calendars: SpaceCalendarSource[]; details: Record<string, RunDetail>; busy: string; canRun: boolean; onOpen: (id: string, trigger: HTMLElement) => void; onDecide: (id: string, approved: boolean) => void; onRetry: (id: string) => void }) {
  const empty = !approvals.length && !failed.length && !updates.length && !integrations.length && !resources.length && !calendars.length;
  return <div className="mx-auto grid max-w-4xl gap-3">{empty ? <EmptyState icon={Check} title="Nothing needs your attention"/> : null}
    {approvals.map(({ run, agent }) => <ApprovalCard key={run.id} run={run} agent={agent} detail={details[run.id]} busy={busy === run.id} canRun={canRun} onOpen={onOpen} onDecide={onDecide}/>)}
    {failed.map(({ run, agent }) => <AttentionCard key={run.id} icon={AlertTriangle} tone="red" title={`${agent.catalog.agent_name} run failed`} detail={`${run.error_message || run.error_code || "A workflow node exhausted its attempts."} · ${formatDate(run.updated_at)}`} action={<><button className={secondaryButton} disabled={!canRun || busy === run.id} onClick={() => void onRetry(run.id)}><RefreshCcw size={12}/>Retry</button><button className={iconButton} onClick={(event) => void onOpen(run.id, event.currentTarget)} aria-label="Inspect failed run"><ChevronRight size={14}/></button></>}/>)}
    {updates.map((item) => <AttentionCard key={item.catalog.agent_id} icon={Sparkles} tone="blue" title={`${item.catalog.agent_name} has an update`} detail="Your pinned version will upgrade only while no run is active or approval-blocked."/>)}
    {integrations.map((item) => <AttentionCard key={item.id} icon={Unplug} tone="red" title={`Reconnect ${providerById(item.provider)?.name ?? item.provider}`} detail={`${item.display_name} · ${item.status.replace(/_/g, " ")}`}/>)}
    {resources.map((item) => <AttentionCard key={item.id} icon={Unplug} tone="red" title={`${providerById(item.provider)?.name ?? item.provider} source needs attention`} detail={`${item.display_name} · ${(item.last_error_code || item.status).replace(/_/g, " ")}`}/>)}
    {calendars.map((item) => <AttentionCard key={item.id} icon={CalendarClock} tone="red" title="Google Calendar source needs attention" detail={`${item.display_name} · ${(item.last_error_code || item.status).replace(/_/g, " ")}`}/>)}
  </div>;
}

function ApprovalCard({ run, agent, detail, busy, canRun, onOpen, onDecide }: { run: SpaceRun; agent: AgentRuntime; detail?: RunDetail; busy: boolean; canRun: boolean; onOpen: (id: string, trigger: HTMLElement) => void; onDecide: (id: string, approved: boolean) => void }) {
  const approval = detail?.approvals.find((item) => item.state === "pending");
  const action = detail?.actions.find((item) => item.state === "proposed");
  const info = approvalCardInfo(approval?.proposed_actions?.[0]);
  return <article className="rounded-2xl border border-amber-400/20 bg-amber-500/[.06] p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-200"><ShieldCheck size={17}/></span><div className="min-w-0 flex-1"><p className="m-0 text-xs font-semibold">{approval?.action_summary ?? action?.summary ?? "Approve external action"}</p><p className="mb-0 mt-1 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">{agent.catalog.agent_name} · {run.workflow_identifier}@{run.workflow_version} · {info.provider || providerLabel(action?.details)}</p>{info.reason ? <p className="mb-0 mt-2 text-[10px] leading-relaxed text-[var(--misty-text-muted)]">{info.reason}</p> : null}<dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl bg-black/15 p-3 text-[9px]"><dt className="text-[var(--misty-text-subtle)]">Bot</dt><dd className="m-0 truncate">{info.bot || "Misty"}</dd><dt className="text-[var(--misty-text-subtle)]">Destination</dt><dd className="m-0 break-all">{info.destination || "Selected workflow destination"}</dd><dt className="text-[var(--misty-text-subtle)]">Connection</dt><dd className="m-0 break-all">{info.connection || "Space installation"}</dd><dt className="text-[var(--misty-text-subtle)]">Expires</dt><dd className="m-0">{approval?.expires_at ? formatDate(approval.expires_at) : "Soon"}</dd></dl>{info.content ? <div className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-xl border border-amber-300/10 bg-black/15 p-3 text-[10px] leading-relaxed text-[var(--misty-text-muted)]">{info.content}</div> : null}{info.citations.length ? <div className="mt-2 flex flex-wrap gap-1" aria-label="Approval citations">{info.citations.slice(0, 4).map((citation, index) => <span className="rounded-md bg-sky-400/10 px-2 py-1 text-[9px] text-sky-200" key={`${citation}-${index}`}>{citation}</span>)}</div> : null}<p className="mb-0 mt-2 text-[9px] text-[var(--misty-text-subtle)]">{info.reversibility || "The destination and permissions are checked again immediately before execution."}</p></div><div className="flex shrink-0 gap-2"><button className={secondaryButton} disabled={!canRun || busy} onClick={() => onDecide(run.id, false)}>Reject</button><button className={primaryButton} disabled={!canRun || busy} onClick={() => onDecide(run.id, true)}>Approve</button><button className={iconButton} onClick={(event) => void onOpen(run.id, event.currentTarget)} aria-label="Inspect approval"><ChevronRight size={14}/></button></div></div></article>;
}

function RunList({ title, empty, items, busy, onOpen }: { title: string; empty: string; items: Array<{ run: SpaceRun; agent: AgentRuntime }>; busy: string; onOpen: (id: string, trigger: HTMLElement) => void }) {
  return <div className="mx-auto grid max-w-4xl gap-2"><h2 className="sr-only">{title}</h2>{!items.length ? <EmptyState icon={Clock3} title={empty}/> : items.map(({ run, agent }) => <button className="grid min-h-14 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 text-left hover:bg-[var(--misty-surface-2)]" type="button" key={run.id} onClick={(event) => void onOpen(run.id, event.currentTarget)}><span className={`size-2 rounded-full ${runTone(run.state)}`}/><span className="min-w-0"><strong className="block truncate text-xs">{agent.catalog.agent_name} · {run.capability_id || run.trigger_kind}</strong><small className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{run.state.replace(/_/g, " ")} · {run.workflow_identifier}@{run.workflow_version} · {formatDate(run.created_at)}</small></span>{busy === run.id ? <LoaderCircle className="animate-spin" size={14}/> : <ChevronRight size={14}/>}</button>)}</div>;
}

function HistoryView({ items, query, setQuery, busy, onOpen }: { items: Array<{ run: SpaceRun; agent: AgentRuntime }>; query: string; setQuery: (value: string) => void; busy: string; onOpen: (id: string, trigger: HTMLElement) => void }) {
  const filtered = items.filter(({ run, agent }) => `${agent.catalog.agent_name} ${run.state} ${run.capability_id} ${run.workflow_identifier}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mx-auto grid max-w-4xl gap-3"><label className="ml-auto flex min-h-8 min-w-56 items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5"><Search size={13}/><input className="min-w-0 flex-1 border-0 bg-transparent text-[11px] outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter runs"/></label><RunList title="Run history" empty="No matching runs." items={filtered} busy={busy} onOpen={onOpen}/></div>;
}

function SettingsView({ spaceId, agents, integrations, providers, busy, setBusy, onReload, setError }: { spaceId: string; agents: AgentRuntime[]; integrations: SpaceIntegration[]; providers: ProviderConnectionAvailability[]; busy: string; setBusy: (value: string) => void; onReload: () => Promise<void>; setError: (value: string) => void }) {
  const [unavailableProviders, setUnavailableProviders] = useState<Set<string>>(() => new Set());
  const connect = async (providerId: string) => {
    setBusy(providerId); setError("");
    try {
      const result = await agentArchitectureApi.beginProviderConnection(spaceId, providerId, window.location.pathname + window.location.search);
      await openProviderAuthorizationLink(result.authorization_url);
    } catch (reason) {
      if (reason instanceof SpaceRequestError && reason.code === "provider_not_configured") {
        setUnavailableProviders((current) => new Set(current).add(providerId));
      }
      setError(errorText(reason));
    } finally { setBusy(""); }
  };
  const disconnect = async (id: string) => {
    setBusy(id); try { await agentArchitectureApi.deleteIntegration(id); await onReload(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const bindConnection = async (instance: AgentInstanceRecord, provider: string, connectionId: string) => {
    setBusy(`${instance.id}:${provider}`);
    try {
      const bindings = { ...instance.connection_bindings };
      if (connectionId) bindings[provider] = connectionId; else delete bindings[provider];
      await agentArchitectureApi.updateInstanceConnections(instance.id, bindings);
      await onReload();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  return <div className="mx-auto grid max-w-5xl gap-5"><p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">Your credentials and Agent activity remain private.</p>
    {agents.map((item) => <section className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4" key={item.catalog.agent_id}><div className="flex items-center justify-between"><div><strong className="text-xs">{item.catalog.agent_name}</strong><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">Pinned version {item.instance?.agent_version_id ?? "not initialized"} · {item.instance?.status ?? "idle"}</p></div>{item.instance?.update_available ? <button className={secondaryButton} disabled={busy === item.catalog.agent_id || item.instance.status !== "idle"} onClick={async () => { setBusy(item.catalog.agent_id); try { await agentArchitectureApi.updateAgentInstance(spaceId, item.catalog.agent_id); await onReload(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }}><RefreshCcw size={12}/>Update</button> : null}</div><div className="mt-3 grid gap-2">{item.instance?.workflows.map((workflow) => <div className="flex items-center justify-between rounded-xl bg-[var(--misty-surface-2)] px-3 py-2" key={workflow.workflow_version_id}><span className="text-[10px]">Workflow {workflow.workflow_version_id}</span><span className={`text-[9px] ${workflow.enabled ? "text-emerald-300" : "text-[var(--misty-text-subtle)]"}`}>{workflow.enabled ? "Enabled" : "Disabled"}</span></div>)}</div>{item.instance && integrations.some((connection) => connection.status === "active") ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{providerCatalog.filter((provider) => integrations.some((connection) => connection.provider === provider.id && connection.status === "active")).map((provider) => <label className="grid gap-1 text-[9px] text-[var(--misty-text-subtle)]" key={provider.id}><span>{provider.name} account</span><select className="min-h-8 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 text-[10px]" disabled={busy === `${item.instance!.id}:${provider.id}`} value={item.instance!.connection_bindings[provider.id] ?? ""} onChange={(event) => void bindConnection(item.instance!, provider.id, event.target.value)}><option value="">Not available to this Agent</option>{integrations.filter((connection) => connection.provider === provider.id && connection.status === "active").map((connection) => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}</select></label>)}</div> : null}</section>)}
    <section><div className="mb-3 flex items-center justify-between"><div><strong className="text-xs">Provider connections</strong><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">OAuth scopes are requested incrementally and tokens never appear in workflow definitions.</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{providerCatalog.map((provider) => { const connection = integrations.find((item) => item.provider === provider.id); const unavailable = providers.find((item) => item.provider === provider.id)?.configured === false || unavailableProviders.has(provider.id); return <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4" key={provider.id}><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: provider.color }}><Plug size={16}/></span><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{provider.name}</strong><p className="mb-0 mt-1 line-clamp-2 text-[9px] leading-relaxed text-[var(--misty-text-subtle)]">{provider.description}</p></div></div>{connection ? <><div className="mt-4 flex items-center justify-between gap-2"><span className={`truncate text-[9px] ${connection.status === "active" ? "text-emerald-300" : "text-amber-200"}`}>{connection.display_name} · {connection.status}</span><button className={iconButton} disabled={busy === connection.id} onClick={() => void disconnect(connection.id)} aria-label={`Disconnect ${provider.name}`}><Unplug size={13}/></button></div>{connection.status === "active" && provider.id !== "google" ? <IntegrationResourceManager spaceId={spaceId} connection={connection} setError={setError}/> : provider.id === "google" && connection.status === "active" ? <p className="mb-0 mt-3 text-[9px] text-[var(--misty-text-subtle)]">Publish calendars from Tasks &amp; Calendar.</p> : null}</> : <><button className={`${secondaryButton} mt-4 w-full justify-center`} disabled={busy === provider.id || unavailable} onClick={() => void connect(provider.id)}>{busy === provider.id ? <LoaderCircle className="animate-spin" size={13}/> : unavailable ? <Unplug size={13}/> : <ExternalLink size={13}/>} {unavailable ? "Unavailable" : "Connect"}</button>{unavailable ? <p className="mb-0 mt-2 text-[9px] leading-relaxed text-amber-200">Sign-in has not been configured on this Misty server.</p> : null}</>}</article>; })}</div></section>
  </div>;
}

function IntegrationResourceManager({ spaceId, connection, setError }: { spaceId: string; connection: SpaceIntegration; setError: (value: string) => void }) {
  const [available, setAvailable] = useState<AvailableProviderResource[]>([]);
  const [published, setPublished] = useState<ProviderSharedResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyResource, setBusyResource] = useState("");

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const [choices, shared] = await Promise.all([
        agentArchitectureApi.availableProviderResources(spaceId, connection.id),
        agentArchitectureApi.sharedProviderResources(spaceId),
      ]);
      setAvailable(choices.resources);
      setPublished(shared.resources.filter((item) => item.integration_id === connection.id && item.status !== "disabled"));
    } catch (reason) { setError(errorText(reason)); } finally { setLoading(false); }
  }, [connection.id, setError, spaceId]);

  useEffect(() => { if (open) void loadResources(); }, [loadResources, open]);
  const toggle = async (resource: AvailableProviderResource) => {
    const current = published.find((item) => item.external_resource_id === resource.external_resource_id && item.resource_type === resource.resource_type);
    const key = `${resource.resource_type}:${resource.external_resource_id}`;
    setBusyResource(key);
    try {
      if (current) await agentArchitectureApi.disableProviderResource(spaceId, current.id);
      else await agentArchitectureApi.publishProviderResource(spaceId, connection.id, resource);
      await loadResources();
    } catch (reason) { setError(errorText(reason)); } finally { setBusyResource(""); }
  };
  return <div className="mt-3 border-t border-[var(--misty-border-soft)] pt-3"><button className={`${secondaryButton} w-full justify-center`} type="button" onClick={() => setOpen((value) => !value)}><FileText size={12}/>{open ? "Hide shared sources" : "Choose shared sources"}</button>{open ? <div className="mt-2 grid max-h-48 gap-1 overflow-auto">{loading && !available.length ? <span className="flex items-center justify-center gap-2 py-4 text-[9px] text-[var(--misty-text-subtle)]"><LoaderCircle className="animate-spin" size={12}/>Loading available sources…</span> : available.map((resource) => { const selected = published.some((item) => item.external_resource_id === resource.external_resource_id && item.resource_type === resource.resource_type); const key = `${resource.resource_type}:${resource.external_resource_id}`; return <label className="flex items-center gap-2 rounded-lg bg-[var(--misty-surface-2)] px-2 py-2 text-[9px]" key={key}><input type="checkbox" checked={selected} disabled={busyResource === key} onChange={() => void toggle(resource)}/><span className="min-w-0 flex-1 truncate">{resource.display_name}</span><small className="text-[8px] uppercase text-[var(--misty-text-subtle)]">{resource.resource_type.replace("_", " ")}</small></label>; })}{!loading && !available.length ? <p className="m-0 py-3 text-center text-[9px] text-[var(--misty-text-subtle)]">No accessible sources were returned by this provider.</p> : null}</div> : null}</div>;
}

function AgentRunDrawer({ detail, loading, canRun, busy, onClose, onDecide, onCancel, onRetry }: { detail?: RunDetail; loading: boolean; canRun: boolean; busy: boolean; onClose: () => void; onDecide: (approved: boolean) => void; onCancel: () => void; onRetry: () => void }) {
  const approval = detail?.approvals.find((item) => item.state === "pending");
  return <div className="fixed inset-0 z-[2147483000] flex justify-end bg-black/55" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <aside className="h-full w-full max-w-xl overflow-auto border-l border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5" role="dialog" aria-modal="true" aria-label="Agent run details">
      <header className="flex items-start justify-between gap-3"><h2 className="m-0 text-sm">{detail?.run.capability_id || detail?.run.trigger_kind || "Agent run"}</h2><button className={iconButton} onClick={onClose} disabled={busy} aria-label="Close run details"><X size={14}/></button></header>
      {loading || !detail ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin" size={18}/></div> : <>
        <div className="mt-4 grid grid-cols-3 gap-2">{[["State", detail.run.state], ["Attempt", String(detail.run.attempt ?? 1)], ["Progress", `${Math.round(detail.run.progress || 0)}%`]].map(([label, value]) => <div className="rounded-xl bg-[var(--misty-surface-2)] p-3" key={label}><span className="block text-[9px] text-[var(--misty-text-subtle)]">{label}</span><strong className="mt-1 block text-[10px] capitalize">{value.replace(/_/g, " ")}</strong></div>)}</div>
        <section className="mt-5"><strong className="text-xs">Node progress</strong><div className="mt-3 grid gap-2">{detail.steps.map((step) => <article className="rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-3" key={step.ID}><div className="flex items-center gap-2"><strong className="text-[10px]">{step.NodeID}</strong><span className="ml-auto text-[9px] capitalize text-[var(--misty-text-subtle)]">{step.State.replace(/_/g, " ")} · attempt {step.Attempt}</span></div>{step.ErrorMessage ? <p className="mb-0 mt-2 text-[9px] text-red-300">{step.ErrorCode}: {step.ErrorMessage}</p> : null}</article>)}</div></section>
        <section className="mt-5"><strong className="text-xs">Action timeline</strong><div className="mt-3 grid gap-2">{detail.actions.map((action) => <article className="rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-3" key={action.id}><div className="flex items-center gap-2">{action.destructive ? <AlertTriangle className="text-amber-200" size={13}/> : <ShieldCheck className="text-emerald-300" size={13}/>}<strong className="text-[10px]">{action.summary}</strong><span className="ml-auto text-[9px] capitalize text-[var(--misty-text-subtle)]">{action.state}</span></div>{Object.keys(action.details ?? {}).length ? <pre className="mb-0 mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[9px] text-[var(--misty-text-subtle)]">{JSON.stringify(action.details, null, 2)}</pre> : null}</article>)}</div></section>
        <section className="mt-5"><strong className="text-xs">Output</strong><pre className="mb-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-black/15 p-3 text-[9px]">{JSON.stringify(detail.run.outputs, null, 2)}</pre></section>
        {approval ? <section className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-500/[.06] p-4"><strong className="text-xs text-amber-100">{approval.action_summary}</strong><pre className="mb-0 mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-black/15 p-3 text-[9px] text-amber-100/80">{JSON.stringify(approval.proposed_actions, null, 2)}</pre><div className="mt-3 flex gap-2"><button className={secondaryButton} disabled={!canRun || busy} onClick={() => onDecide(false)}>Reject</button><button className={primaryButton} disabled={!canRun || busy} onClick={() => onDecide(true)}>Approve</button></div></section> : null}
        <footer className="mt-5 flex justify-end gap-2">{["queued", "running", "cooldown"].includes(detail.run.state) ? <button className={secondaryButton} disabled={!canRun || busy} onClick={onCancel}><CircleStop size={12}/>Cancel</button> : null}{detail.run.state === "failed" ? <button className={secondaryButton} disabled={!canRun || busy} onClick={onRetry}><RefreshCcw size={12}/>Retry</button> : null}</footer>
      </>}
    </aside>
  </div>;
}

function AgentRailRow({ active, name, detail, attention, running, onClick }: { active: boolean; name: string; detail: string; attention: number; running: number; onClick: () => void }) { return <button className={`grid min-h-14 w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-0 px-2.5 text-left ${active ? "bg-[var(--misty-surface-3)]" : "bg-transparent hover:bg-[var(--misty-surface-2)]"}`} onClick={onClick} type="button"><span className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-200"><Bot size={15}/></span><span className="min-w-0"><strong className="block truncate text-xs">{name}</strong><small className="mt-1 block truncate text-[9px] text-[var(--misty-text-subtle)]">{detail}</small></span><span className="flex gap-1">{attention ? <i className="grid min-w-5 place-items-center rounded-full bg-amber-400/15 px-1 text-[9px] not-italic text-amber-200">{attention}</i> : null}{running ? <i className="grid min-w-5 place-items-center rounded-full bg-sky-400/15 px-1 text-[9px] not-italic text-sky-200">{running}</i> : null}</span></button>; }
function AttentionCard({ icon: Icon, tone, title, detail, action }: { icon: typeof AlertTriangle; tone: "red" | "blue"; title: string; detail: string; action?: React.ReactNode }) { return <article className={`flex items-center gap-3 rounded-2xl border p-4 ${tone === "red" ? "border-red-400/20 bg-red-500/[.05]" : "border-sky-400/20 bg-sky-500/[.05]"}`}><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone === "red" ? "bg-red-400/10 text-red-200" : "bg-sky-400/10 text-sky-200"}`}><Icon size={16}/></span><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{title}</strong><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{detail}</p></div>{action ? <div className="flex gap-2">{action}</div> : null}</article>; }
function EmptyState({ icon: Icon, title }: { icon: typeof Check; title: string }) { return <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-[var(--misty-border-soft)] text-center"><div><Icon className="mx-auto text-[var(--misty-text-subtle)]" size={20}/><strong className="mt-2 block text-[11px]">{title}</strong></div></div>; }

const tabDefinitions: Array<{ id: AgentCenterTab; label: string; icon: typeof Inbox }> = [
  { id: "attention", label: "Needs attention", icon: ShieldCheck }, { id: "results", label: "Results", icon: Inbox }, { id: "activity", label: "Activity", icon: CalendarClock }, { id: "history", label: "History", icon: History }, { id: "settings", label: "Settings", icon: Settings2 },
  { id: "studio", label: "Studio", icon: Sparkles },
];
function normalizeAgentTab(value: string, canRun: boolean, canViewStudio: boolean): AgentCenterTab { if (value === "studio") return canViewStudio ? "studio" : "attention"; if (canRun && ["attention","results","activity","history","settings"].includes(value)) return value as AgentCenterTab; return canRun ? "attention" : "studio"; }
function tabButton(active: boolean) { return `inline-flex min-h-8 items-center gap-1.5 rounded-lg border-0 px-2.5 text-[10px] ${active ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`; }
function studioSwitch(active: boolean) { return `inline-flex min-h-7 items-center gap-1.5 rounded-md border-0 px-2 text-[9px] ${active ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)]"}`; }
const iconButton = "grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text-muted)] disabled:opacity-40";
const secondaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[10px] text-[var(--misty-text)] disabled:opacity-40";
const primaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border-0 bg-[var(--misty-primary)] px-2.5 text-[10px] text-[var(--misty-primary-contrast)] disabled:opacity-40";
function formatDate(value: string) { return new Date(value).toLocaleString(); }
function runTone(state: string) { if (state === "completed") return "bg-emerald-400"; if (state === "completed_with_errors" || state === "cooldown" || state === "awaiting_approval") return "bg-amber-400"; if (state === "failed" || state === "rejected") return "bg-red-400"; return "bg-sky-400"; }
function providerLabel(details: Record<string, unknown> | undefined) { const provider = typeof details?.provider === "string" ? details.provider : "external provider"; return providerById(provider)?.name ?? provider; }
function approvalCardInfo(action: Record<string, unknown> | undefined) {
  const envelope = action ?? {};
  const input = envelope.input && typeof envelope.input === "object" ? envelope.input as Record<string, unknown> : {};
  const botValue = envelope.bot_identity ?? input.bot_identity;
  const bot = botValue && typeof botValue === "object" ? botValue as Record<string, unknown> : {};
  const provider = typeof envelope.provider === "string" ? envelope.provider : typeof input.provider === "string" ? input.provider : "";
  const rawCitations = Array.isArray(envelope.citations) ? envelope.citations : Array.isArray(input.citations) ? input.citations : [];
  return {
    provider: provider ? providerById(provider)?.name ?? provider : "",
    bot: typeof bot.name === "string" ? bot.name : "",
    destination: typeof envelope.destination === "string" ? envelope.destination : typeof input.destination === "string" ? input.destination : "",
    connection: typeof envelope.connection_id === "string" ? envelope.connection_id : typeof input.connection_id === "string" ? input.connection_id : "",
    content: typeof envelope.content_preview === "string" ? envelope.content_preview : typeof input.content_preview === "string" ? input.content_preview : "",
    reason: typeof envelope.reason === "string" ? envelope.reason : typeof input.reason === "string" ? input.reason : "",
    citations: rawCitations.map(formatApprovalCitation).filter(Boolean),
    reversibility: typeof envelope.reversibility === "string" ? envelope.reversibility : typeof input.reversibility === "string" ? input.reversibility : "",
  };
}
function formatApprovalCitation(value: unknown) { if (typeof value === "string") return value; if (!value || typeof value !== "object") return ""; const citation = value as Record<string, unknown>; for (const key of ["locator", "displayName", "display_name", "resourceId", "resource_id"]) if (typeof citation[key] === "string" && citation[key]) return citation[key] as string; return "Referenced source"; }
function attentionForAgent(item: AgentRuntime, details: Record<string, RunDetail>, integrations: SpaceIntegration[]) { const runAttention = item.runs.filter((run) => run.state === "failed" || run.state === "awaiting_approval" || details[run.id]?.approvals.some((approval) => approval.state === "pending")).length; const providers = new Set(item.catalog.workflow?.metadata?.requiredIntegrations ?? []); const connections = integrations.filter((integration) => providers.has(integration.provider) && integration.status !== "active").length; return runAttention + connections + (item.instance?.update_available ? 1 : 0); }
