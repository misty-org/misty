import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleStop, History, LockKeyhole, Play, Plus, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type { AgentInstanceRecord, PublishedAgentVersion, RunAction, RunApproval, SpaceIntegration, SpaceRun, SpaceStudioResource, WorkflowVersion } from "../../spaces/types";
import { errorText } from "../../shared/format";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { openProviderAuthorizationLink } from "../../shared/openExternalLink";
import { AgentConversationPanel } from "./AgentConversation";
import { useAuth } from "../../auth/AuthContext";

export function AgentArchitecturePanel(props: { agent: SpaceStudioResource; spaceName: string; workflows: SpaceStudioResource[]; canManage: boolean; canRun: boolean; initialRunId?: string; onAgentUpdated: (agent: SpaceStudioResource) => void }) {
	const { user } = useAuth();
	const canEditDefinition = props.canManage && props.agent.creator_user_id === user?.id;
  const canExecute = props.canRun && props.agent.enabled && props.agent.status === "available";
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
	const [publishedVersions, setPublishedVersions] = useState<PublishedAgentVersion[]>([]);
	const [instance, setInstance] = useState<AgentInstanceRecord | null>(null);
	const [attachedVersionIds, setAttachedVersionIds] = useState<string[]>([]);
	const [availableWorkflowVersions, setAvailableWorkflowVersions] = useState<WorkflowVersion[]>([]);
  const [runs, setRuns] = useState<SpaceRun[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [selectedPackage, setSelectedPackage] = useState(props.agent.active_workflow?.workflow_id ?? props.workflows[0]?.id ?? "");
  const [selectedVersion, setSelectedVersion] = useState(props.agent.active_workflow?.id ?? "");
  const [capability, setCapability] = useState("chat");
  const [prompt, setPrompt] = useState("");
  const [detail, setDetail] = useState<{ run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateOpen, setPrivateOpen] = useState(false);
  const [integrationProvider, setIntegrationProvider] = useState("");
	const [scheduleExpression, setScheduleExpression] = useState("0 9 * * 1-5");
	const [scheduleTimezone, setScheduleTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const runDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const privateChatReturnFocusRef = useRef<HTMLElement | null>(null);
  const integrationDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const integrationDialog = useDialogFocus<HTMLFormElement>(Boolean(integrationProvider), integrationDialogReturnFocusRef);
  const openedInitialRunRef = useRef("");
  const closeIntegrationDialog = () => {
    if (busy) return;
    setIntegrationProvider("");
  };
	const attachedWorkflows = availableWorkflowVersions.filter((item) => attachedVersionIds.includes(item.id));
	const capabilities = useMemo(() => [{ id: "chat", name: "Ordinary chat" }, ...attachedWorkflows.flatMap((item) => item.metadata.capabilities.map((entry) => ({ id: entry.id, name: `${item.name} · ${entry.name}` })))], [attachedWorkflows]);

  const refreshRuns = async () => {
    const [{ runs: nextRuns }, { integrations: nextIntegrations }] = await Promise.all([
      agentArchitectureApi.runs(props.agent.space_id, props.agent.id),
      agentArchitectureApi.integrations(props.agent.space_id),
    ]);
    setRuns(nextRuns); setIntegrations(nextIntegrations);
  };
  const loadVersions = async (workflowId: string) => {
    if (!workflowId) { setVersions([]); return; }
    const response = await agentArchitectureApi.workflowVersions(props.agent.space_id, workflowId);
    setVersions(response.versions);
    setSelectedVersion((current) => response.versions.some((item) => item.id === current) ? current : response.versions[0]?.id ?? "");
  };
	const refreshDefinition = async () => {
		const versionLists = await Promise.all(props.workflows.map((item) => agentArchitectureApi.workflowVersions(props.agent.space_id, item.id)));
		const flattened = versionLists.flatMap((item) => item.versions);
		const [{ versions: agentVersions }, nextInstance] = await Promise.all([
			agentArchitectureApi.agentVersions(props.agent.space_id, props.agent.id),
			canExecute ? agentArchitectureApi.agentInstance(props.agent.space_id, props.agent.id).catch(() => null) : Promise.resolve(null),
		]);
		setAvailableWorkflowVersions(flattened);
		setPublishedVersions(agentVersions);
		setInstance(nextInstance);
		if (agentVersions[0]) setAttachedVersionIds(agentVersions[0].workflows.filter((item) => item.enabled).map((item) => item.workflow_version_id));
	};

  useEffect(() => { void refreshRuns().catch((reason) => setError(errorText(reason))); }, [props.agent.id, props.agent.space_id]);
	useEffect(() => { void refreshDefinition().catch((reason) => setError(errorText(reason))); }, [props.agent.id, props.agent.space_id, props.workflows.map((item) => `${item.id}:${item.version}`).join("|")]);
  useEffect(() => { void loadVersions(selectedPackage).catch((reason) => setError(errorText(reason))); }, [props.agent.space_id, selectedPackage]);
	useEffect(() => { if (!capabilities.some((item) => item.id === capability)) setCapability("chat"); }, [capabilities, capability]);
  useEffect(() => {
    if (!props.initialRunId || openedInitialRunRef.current === props.initialRunId) return;
    openedInitialRunRef.current = props.initialRunId;
    void openRun(props.initialRunId);
  }, [props.initialRunId]);

  const availableIntegrations = useMemo(() => new Set(integrations.filter((item) => item.status === "active").map((item) => item.provider)), [integrations]);
	const missingIntegrations = attachedWorkflows.flatMap((item) => item.metadata.requiredIntegrations).filter((item, index, all) => !availableIntegrations.has(item) && all.indexOf(item) === index);

  const run = async () => {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true); setError("");
    try {
      const response = await agentArchitectureApi.run(props.agent.space_id, props.agent.id, { prompt: text, capability_id: capability, input: { prompt: text } });
      if ("id" in response) await openRun(response.id, runButtonRef.current);
      else if ("run" in response && response.run) await openRun(response.run.id, runButtonRef.current);
      else if ("routing" in response) setError(response.routing.question || "Choose a capability before running this agent.");
      await refreshRuns();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const publishAttachments = async () => {
		if (!attachedVersionIds.length && !window.confirm("Publish this Agent without workflows? It will still support ordinary chat.")) return;
    setBusy(true); setError("");
    try {
			await agentArchitectureApi.publishAgentVersion(props.agent.space_id, props.agent.id, attachedVersionIds.map((workflowVersionId, position) => ({ workflow_version_id: workflowVersionId, alias: `workflow-${position + 1}`, enabled: true, position })));
			await refreshDefinition();
    }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
	const addAttachment = () => {
		if (selectedVersion && !attachedVersionIds.includes(selectedVersion)) setAttachedVersionIds((current) => [...current, selectedVersion]);
	};
	const updateInstance = async () => {
		if (!instance) return;
		setBusy(true); setError("");
		try { setInstance(await agentArchitectureApi.updateAgentInstance(props.agent.space_id, props.agent.id)); }
		catch (reason) { setError(errorText(reason)); }
		finally { setBusy(false); }
	};
	const setAutomationEnabled = async (workflowVersionId: string, enabled: boolean) => {
		if (!instance) return;
		setBusy(true); setError("");
		try {
			const workflow = attachedWorkflows.find((item) => item.id === workflowVersionId);
			const hasCron = workflowDefinitionHasNode(workflow?.definition, "cron_trigger");
			const capabilityId = workflow?.metadata.capabilities[0]?.id ?? "";
			const triggerConfig = hasCron ? { kind: "cron", expression: scheduleExpression.trim(), timezone: scheduleTimezone, capabilityId } : { kind: "event", capabilityId };
			await agentArchitectureApi.configureInstanceWorkflow(instance.id, workflowVersionId, { enabled, trigger_config: triggerConfig, consent: { granted: enabled, reviewed_at: new Date().toISOString(), preauthorizedWrites: enabled ? workflowPreauthorizedWrites(workflow?.definition, instance.connection_bindings) : [] } });
			setInstance(await agentArchitectureApi.agentInstance(props.agent.space_id, props.agent.id));
			setError(enabled ? "Automation enabled for your Space Agent." : "Automation disabled for your Space Agent.");
		}
		catch (reason) { setError(errorText(reason)); }
		finally { setBusy(false); }
	};
  const connectIntegration = async () => {
    if (!integrationProvider) return;
    setBusy(true); setError("");
		try {
			const started = await agentArchitectureApi.beginProviderConnection(props.agent.space_id, integrationProvider, window.location.pathname);
			await openProviderAuthorizationLink(started.authorization_url);
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const openRun = async (id: string, returnFocus?: HTMLElement | null) => {
    if (returnFocus) runDialogReturnFocusRef.current = returnFocus;
    try { setDetail(await agentArchitectureApi.runDetail(id)); }
    catch (reason) { setError(errorText(reason)); }
  };
  const decide = async (approved: boolean) => {
    if (!detail) return;
    setBusy(true); setError("");
    try { await agentArchitectureApi.decideRun(detail.run.id, approved); await openRun(detail.run.id); await refreshRuns(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!detail) return;
    setBusy(true); setError("");
    try { await agentArchitectureApi.cancelRun(detail.run.id); await openRun(detail.run.id); await refreshRuns(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const retry = async () => {
    if (!detail) return;
    setBusy(true); setError("");
    try { const next = await agentArchitectureApi.retryRun(detail.run.id); await openRun(next.id); await refreshRuns(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  return <div className="grid gap-4">
    <section className={sectionClass}>
		<div className="flex flex-wrap items-start justify-between gap-3"><div><p className={eyebrowClass}>Your use of this Space Agent</p><h3 className="mb-1 mt-1 text-sm">{instance?.status === "running" ? "Running" : "Idle"} <span className="font-normal text-[var(--misty-text-subtle)]">· your history, memory, credentials, cursors, and approvals stay isolated</span></h3><p className="m-0 text-[11px] text-[var(--misty-text-muted)]">Pinned Agent version: {publishedVersions.find((item) => item.id === instance?.agent_version_id)?.version ?? "not initialized"}</p></div><div className="flex items-center gap-2">{instance?.update_available ? <button className={miniButton} disabled={busy || instance.status !== "idle"} type="button" onClick={() => void updateInstance()}><RefreshCcw size={12}/>Update Agent</button> : null}{canExecute ? <button className={miniButton} type="button" onClick={(event) => { privateChatReturnFocusRef.current = event.currentTarget; setPrivateOpen(true); }}><LockKeyhole size={12}/>Chat with Agent</button> : null}</div></div>
		<div className="mt-3 rounded-xl bg-[var(--misty-surface-2)] p-3"><strong className="text-xs">Ordinary chat</strong><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">Always available without a workflow. Mika can use tools granted through this user’s connections and permissions.</p></div>
		<div className="mt-3 grid gap-2">{attachedWorkflows.map((attached) => { const configured = instance?.workflows?.find((item) => item.workflow_version_id === attached.id); const scheduled = workflowDefinitionHasNode(attached.definition, "cron_trigger"); return <article className="rounded-xl bg-[var(--misty-surface-2)] p-3" key={attached.id}><div className="flex items-center justify-between gap-2"><div><strong className="text-xs">{attached.name}</strong><span className="ml-2 text-[9px] text-[var(--misty-text-subtle)]">{attached.version} · {configured?.enabled ? "enabled" : "disabled"}</span></div>{instance ? <div className="flex gap-1"><button className={miniButton} disabled={busy || configured?.enabled} onClick={() => void setAutomationEnabled(attached.id, true)}>Enable for me</button><button className={miniButton} disabled={busy || !configured?.enabled} onClick={() => void setAutomationEnabled(attached.id, false)}>Disable</button></div> : null}</div>{scheduled ? <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2"><input className={inputClass} value={scheduleExpression} onChange={(event) => setScheduleExpression(event.target.value)} aria-label={`${attached.name} cron expression`} placeholder="0 9 * * 1-5"/><input className={inputClass} value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} aria-label={`${attached.name} timezone`} placeholder="America/Los_Angeles"/></div> : null}<p className="mb-0 mt-1 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">{attached.metadata.capabilities.map((item) => item.name).join(", ")} · users configure triggers, connections, and consent independently</p></article>; })}</div>
		{!attachedWorkflows.length ? <p className="mb-0 mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">No workflows are attached. This Agent still works through ordinary chat.</p> : null}
      {missingIntegrations.length ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-200"><AlertTriangle size={13}/><span>Connect these providers for your use of this Agent:</span>{canExecute ? missingIntegrations.map((provider) => <button className={miniButton} disabled={busy} type="button" key={provider} onClick={(event) => { integrationDialogReturnFocusRef.current = event.currentTarget; setIntegrationProvider(provider); }}>Connect {provider}</button>) : <span>You need permission to run Agents.</span>}</div> : null}
    </section>

    <section className={sectionClass}>
		<p className={eyebrowClass}>Version-pinned workflow attachments</p><div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"><select className={inputClass} disabled={!canEditDefinition} value={selectedPackage} onChange={(event) => setSelectedPackage(event.target.value)} aria-label="Workflow package"><option value="">Choose workflow…</option>{props.workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={inputClass} disabled={!canEditDefinition} value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)} aria-label="Workflow version"><option value="">Choose version…</option>{versions.map((item) => <option value={item.id} key={item.id}>{item.version} · {item.author_name}</option>)}</select><button className={secondaryButton} disabled={!canEditDefinition || busy || !selectedVersion || attachedVersionIds.includes(selectedVersion)} type="button" onClick={addAttachment}><Plus size={13}/>Attach</button></div>
		<div className="mt-3 flex flex-wrap gap-2">{attachedVersionIds.map((versionId) => { const item = availableWorkflowVersions.find((candidate) => candidate.id === versionId); return <span key={versionId} className="inline-flex items-center gap-1 rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px]">{item?.name ?? versionId}@{item?.version}<button className="p-0.5" disabled={!canEditDefinition} onClick={() => setAttachedVersionIds((current) => current.filter((id) => id !== versionId))}><X size={11}/></button></span>; })}</div>
		<div className="mt-3 flex items-center justify-between"><p className="m-0 text-[9px] text-[var(--misty-text-subtle)]">Only the Agent creator can publish. Existing user instances stay pinned until each user updates while idle; expanded capabilities require renewed consent.</p><button className={primaryButton} disabled={!canEditDefinition || busy} type="button" onClick={() => void publishAttachments()}><RefreshCcw size={13}/>Publish Agent version</button></div>
    </section>

    <section className={sectionClass}>
		<p className={eyebrowClass}>Test run</p>{canExecute ? <div className="mt-2 grid grid-cols-[220px_minmax(0,1fr)_auto] gap-2"><select className={inputClass} value={capability} onChange={(event) => setCapability(event.target.value)} aria-label="Agent test capability">{capabilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input className={inputClass} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask normally or invoke a pinned workflow…" aria-label="Agent test prompt"/><button ref={runButtonRef} className={primaryButton} disabled={busy || !prompt.trim() || (capability !== "chat" && missingIntegrations.length > 0)} type="button" onClick={() => void run()}><Play size={13}/>{busy ? "Working…" : "Run"}</button></div> : <p className="mb-0 mt-2 text-[10px] text-[var(--misty-text-subtle)]">{!props.canRun ? "You do not have permission to run Agents in this Space." : props.agent.enabled ? "This Agent is currently unavailable on its runtime." : "Enable and publish this Agent before starting a run or conversation."}</p>}{error ? <p className="mb-0 mt-2 text-[10px] text-red-300" role="alert">{error}</p> : null}
    </section>

    <section className={sectionClass}>
      <div className="flex items-center justify-between"><p className={eyebrowClass}>Run history</p><button className={miniButton} type="button" onClick={() => void refreshRuns().catch((reason) => setError(errorText(reason)))}><History size={12}/>Refresh</button></div><div className="mt-2 grid max-h-52 gap-1 overflow-auto">{runs.length ? runs.map((item) => <button className="grid grid-cols-[90px_minmax(0,1fr)_90px] items-center gap-2 rounded-lg border-0 bg-[var(--misty-surface-2)] px-3 py-2 text-left" type="button" key={item.id} onClick={(event) => void openRun(item.id, event.currentTarget)}><span className="text-[10px] capitalize">{item.state.replace(/_/g, " ")}</span><span className="truncate text-[10px] text-[var(--misty-text-subtle)]">{item.capability_id} · {item.source_type}</span><span className="text-right text-[9px] text-[var(--misty-text-subtle)]">{item.workflow_version}</span></button>) : <p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">No runs yet.</p>}</div>
    </section>

    {detail ? <RunDetailDialog detail={detail} resourceName={props.agent.name} spaceName={props.spaceName} busy={busy} canRetry={canExecute} operationError={error} returnFocusRef={runDialogReturnFocusRef} onClose={() => setDetail(null)} onDecide={decide} onCancel={cancel} onRetry={retry}/> : null}
    {privateOpen ? <AgentConversationPanel agent={props.agent} returnFocusRef={privateChatReturnFocusRef} onClose={() => setPrivateOpen(false)}/> : null}
    {integrationProvider ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeIntegrationDialog(); }}><form ref={integrationDialog.dialogRef} className="w-full max-w-md rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="connect-integration-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); closeIntegrationDialog(); } else integrationDialog.trapFocus(event); }} onSubmit={(event) => { event.preventDefault(); void connectIntegration(); }}><div className="flex items-start justify-between gap-3"><div><p className={eyebrowClass}>Private provider connection</p><h3 className="mb-1 mt-1 text-sm" id="connect-integration-title">Connect {integrationProvider}</h3><p className="m-0 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">Misty will open the provider’s official authorization screen. Tokens are encrypted server-side and remain private to your Agent instance.</p></div><button className={miniButton} disabled={busy} type="button" onClick={closeIntegrationDialog} aria-label="Close integration dialog"><X size={13}/></button></div><div className="mt-5 flex justify-end gap-2"><button className={secondaryButton} disabled={busy} type="button" onClick={closeIntegrationDialog}>Cancel</button><button data-dialog-autofocus className={primaryButton} disabled={busy} type="submit">{busy ? "Opening…" : "Continue to provider"}</button></div></form></div> : null}
  </div>;
}

export function RunDetailDialog({ detail, resourceName, spaceName, busy, canRetry = true, operationError = "", returnFocusRef, onClose, onDecide, onCancel, onRetry }: { detail: { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] }; resourceName: string; spaceName: string; busy: boolean; canRetry?: boolean; operationError?: string; returnFocusRef?: { current: HTMLElement | null }; onClose: () => void; onDecide: (approved: boolean) => void; onCancel: () => void; onRetry: () => void }) {
  const approval = detail.approvals.find((item) => item.state === "pending");
  const cancelable = ["queued", "running", "cooldown", "awaiting_approval"].includes(detail.run.state);
  const retryable = canRetry && (detail.run.state === "failed" || detail.run.state === "canceled" || detail.run.state === "completed_with_errors");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    const previouslyFocused = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);
  useEffect(() => {
    if (!busy && dialogRef.current && !dialogRef.current.contains(document.activeElement)) closeButtonRef.current?.focus();
  }, [busy, detail.run.id, detail.run.state]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}><section ref={dialogRef} className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}><div className="flex justify-between gap-3"><div><p className={eyebrowClass}>Isolated run · {spaceName}</p><h3 className="mb-1 mt-1 text-sm" id={titleId}>{resourceName} · {detail.run.capability_id} · {detail.run.state}</h3><p className="m-0 text-[10px] text-[var(--misty-text-subtle)]" id={descriptionId}>{detail.run.workflow_identifier}@{detail.run.workflow_version} · {detail.run.id}</p></div><div className="flex gap-2">{cancelable ? <button className={secondaryButton} disabled={busy} type="button" onClick={onCancel}><CircleStop size={13}/>Cancel</button> : null}{retryable ? <button className={secondaryButton} disabled={busy} type="button" onClick={onRetry}><RefreshCcw size={13}/>Retry</button> : null}<button ref={closeButtonRef} className={miniButton} disabled={busy} type="button" onClick={onClose} aria-label="Close run details"><X size={13}/>Close</button></div></div><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><RunJSON title="Inputs" value={detail.run.input}/><RunJSON title="Outputs" value={detail.run.outputs}/></div>{operationError ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-950/20 p-3 text-xs text-red-200" role="alert">{operationError}</p> : detail.run.error_message ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-950/20 p-3 text-xs text-red-200" role="alert">{detail.run.error_message}</p> : null}<div className="mt-4 grid gap-2">{detail.actions.map((action) => <div className="rounded-lg bg-[var(--misty-surface-2)] p-3" key={action.id}><p className="m-0 flex items-center gap-1.5 text-xs">{action.destructive ? <AlertTriangle size={13} className="text-amber-300"/> : <ShieldCheck size={13} className="text-emerald-300"/>}{action.summary}</p><p className="mb-0 mt-1 text-[9px] text-[var(--misty-text-subtle)]">{action.action_kind} · {action.state}</p></div>)}</div>{approval ? <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3"><p className="m-0 text-xs text-amber-100">{approval.action_summary}</p><pre className="mb-0 mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-[9px] text-amber-100/80">{JSON.stringify(approval.proposed_actions, null, 2)}</pre><div className="mt-3 flex gap-2"><button className={secondaryButton} disabled={busy} type="button" onClick={() => onDecide(false)}><CircleStop size={13}/>Reject</button><button className={primaryButton} disabled={busy} type="button" onClick={() => onDecide(true)}><Check size={13}/>Approve</button></div></div> : null}</section></div>;
}

function RunJSON({ title, value }: { title: string; value: unknown }) { return <div><p className={eyebrowClass}>{title}</p><pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-black/20 p-3 text-[10px]">{JSON.stringify(value, null, 2)}</pre></div>; }
function workflowDefinitionHasNode(definition: Record<string, unknown> | undefined, kind: string): boolean {
	if (!definition) return false;
	const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
	return nodes.some((value) => {
		if (!value || typeof value !== "object") return false;
		const node = value as { kind?: unknown; config?: { childGraph?: Record<string, unknown> } };
		return node.kind === kind || workflowDefinitionHasNode(node.config?.childGraph, kind);
	});
}
function workflowPreauthorizedWrites(definition: Record<string, unknown> | undefined, connections: Record<string, string>): Array<Record<string, string>> {
	if (!definition || !Array.isArray(definition.nodes)) return [];
	const safeWriteKinds = new Set(["create_document", "write_library_artifact", "post_reply", "update_metadata", "exact_tool"]);
	return definition.nodes.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const node = value as { id?: unknown; kind?: unknown; config?: Record<string, unknown> };
		if (typeof node.id !== "string" || typeof node.kind !== "string" || !safeWriteKinds.has(node.kind)) return [];
		const provider = typeof node.config?.provider === "string" ? node.config.provider : "";
		const destination = typeof node.config?.destination === "string" ? node.config.destination : typeof node.config?.outputDirectory === "string" ? node.config.outputDirectory : typeof node.config?.filename === "string" ? node.config.filename : "";
		if (!destination) return [];
		return [{ nodeId: node.id, provider, connectionId: provider ? connections[provider] ?? "" : "", destination }];
	});
}
function Badge({ text, warning = false }: { text: string; warning?: boolean }) { return <span className={`rounded-full px-2 py-1 text-[8px] ${warning ? "bg-amber-500/10 text-amber-200" : "bg-white/5 text-[var(--misty-text-subtle)]"}`}>{text}</span>; }
const sectionClass = "rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4";
const eyebrowClass = "m-0 text-[9px] font-semibold capitalize text-[var(--misty-text-subtle)]";
const inputClass = "min-h-9 min-w-0 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] outline-none";
const primaryButton = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-[11px] text-[var(--misty-primary-contrast)] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] disabled:opacity-50";
const miniButton = "inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 text-[9px]";
