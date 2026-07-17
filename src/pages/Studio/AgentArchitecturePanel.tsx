import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleStop, History, LockKeyhole, Play, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type { RunAction, RunApproval, SpaceIntegration, SpaceRun, SpaceStudioResource, WorkflowVersion } from "../../spaces/types";
import { errorText } from "../../shared/format";
import { PrivateAgentConversationPanel } from "./PrivateAgentConversation";

export function AgentArchitecturePanel(props: { agent: SpaceStudioResource; workflows: SpaceStudioResource[]; onAgentUpdated: (agent: SpaceStudioResource) => void }) {
  const workflow = props.agent.active_workflow;
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [runs, setRuns] = useState<SpaceRun[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [selectedPackage, setSelectedPackage] = useState(workflow?.workflow_id ?? "");
  const [selectedVersion, setSelectedVersion] = useState(workflow?.id ?? "");
  const [capability, setCapability] = useState(workflow?.metadata.capabilities[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [detail, setDetail] = useState<{ run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateOpen, setPrivateOpen] = useState(false);

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

  useEffect(() => { void refreshRuns().catch((reason) => setError(errorText(reason))); }, [props.agent.id, props.agent.space_id]);
  useEffect(() => { void loadVersions(selectedPackage).catch((reason) => setError(errorText(reason))); }, [props.agent.space_id, selectedPackage]);
  useEffect(() => {
    setSelectedPackage(workflow?.workflow_id ?? ""); setSelectedVersion(workflow?.id ?? "");
    setCapability(workflow?.metadata.capabilities[0]?.id ?? "");
  }, [workflow?.id, workflow?.workflow_id]);

  const availableIntegrations = useMemo(() => new Set(integrations.filter((item) => item.status === "active").map((item) => item.provider)), [integrations]);
  const missingIntegrations = workflow?.metadata.requiredIntegrations.filter((item) => !availableIntegrations.has(item)) ?? [];

  const run = async () => {
    const text = prompt.trim();
    if (!text || !capability) return;
    setBusy(true); setError("");
    try {
      const response = await agentArchitectureApi.run(props.agent.space_id, props.agent.id, { prompt: text, capability_id: capability, input: { prompt: text } });
      if ("id" in response) await openRun(response.id);
      else if ("run" in response && response.run) await openRun(response.run.id);
      else if ("routing" in response) setError(response.routing.question || "Choose a capability before running this agent.");
      await refreshRuns();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const replace = async () => {
    if (!selectedVersion || selectedVersion === workflow?.id) return;
    setBusy(true); setError("");
    try { props.onAgentUpdated(await agentArchitectureApi.replaceAgentWorkflow(props.agent.space_id, props.agent.id, selectedVersion)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const connectIntegration = async (provider: string) => {
    const reference = window.prompt(`Vault connection reference for ${provider}`, "");
    if (!reference?.trim()) return;
    setBusy(true); setError("");
    try {
      await agentArchitectureApi.saveIntegration(props.agent.space_id, { provider, display_name: provider, credential_reference: reference.trim(), granted_permissions: [], status: "active" });
      await refreshRuns();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const openRun = async (id: string) => setDetail(await agentArchitectureApi.runDetail(id));
  const decide = async (approved: boolean) => {
    if (!detail) return;
    setBusy(true);
    try { await agentArchitectureApi.decideRun(detail.run.id, approved); await openRun(detail.run.id); await refreshRuns(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  if (!workflow) return <p className="m-0 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">This agent has no active workflow. Save it once to create its default portable workflow package.</p>;
  return <div className="grid gap-4">
    <section className={sectionClass}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className={eyebrowClass}>Active workflow</p><h3 className="mb-1 mt-1 text-sm">{workflow.name} <span className="font-normal text-[var(--misty-text-subtle)]">{workflow.stable_identifier}@{workflow.version}</span></h3><p className="m-0 text-[11px] text-[var(--misty-text-muted)]">{workflow.description} · {workflow.author_name}</p></div><div className="flex items-center gap-2"><button className={miniButton} type="button" onClick={() => setPrivateOpen(true)}><LockKeyhole size={12}/>Private chat</button><span className="rounded-full bg-sky-500/10 px-2 py-1 text-[9px] text-sky-200">{workflow.metadata.runtime.kind} / {workflow.metadata.runtime.compatibility}</span></div></div>
      <div className="mt-3 grid gap-2">{workflow.metadata.capabilities.map((item) => <article className="rounded-xl bg-[var(--misty-surface-2)] p-3" key={item.id}><div className="flex items-center justify-between gap-2"><strong className="text-xs">{item.name}</strong><div className="flex gap-1">{item.readOnly ? <Badge text="Read-only"/> : null}{item.destructive ? <Badge text="Destructive" warning/> : null}{item.confirmationRequired ? <Badge text="Approval" warning/> : null}</div></div><p className="mb-0 mt-1 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">{item.description} · Inputs: {item.inputs.map((field) => field.name).join(", ") || "none"} · Outputs: {item.outputs.map((field) => field.name).join(", ") || "none"}</p></article>)}</div>
      <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-[var(--misty-text-subtle)]"><span>Permissions: {workflow.metadata.requiredPermissions.join(", ") || "none"}</span><span>·</span><span>Integrations: {workflow.metadata.requiredIntegrations.join(", ") || "none"}</span></div>
      {missingIntegrations.length ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-200"><AlertTriangle size={13}/><span>Connect these providers in this Space before running:</span>{missingIntegrations.map((provider) => <button className={miniButton} disabled={busy} type="button" key={provider} onClick={() => void connectIntegration(provider)}>Connect {provider}</button>)}</div> : null}
    </section>

    <section className={sectionClass}>
      <p className={eyebrowClass}>Explicit workflow replacement</p><div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"><select className={inputClass} value={selectedPackage} onChange={(event) => setSelectedPackage(event.target.value)}><option value={workflow.workflow_id}>{workflow.name} (current package)</option>{props.workflows.filter((item) => item.id !== workflow.workflow_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={inputClass} value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}>{versions.map((item) => <option value={item.id} key={item.id}>{item.version} · {item.author_name}</option>)}</select><button className={secondaryButton} disabled={busy || !selectedVersion || selectedVersion === workflow.id} type="button" onClick={() => void replace()}><RefreshCcw size={13}/>Replace</button></div><p className="mb-0 mt-2 text-[9px] text-[var(--misty-text-subtle)]">Editing agent identity never changes this selection. Replacement is an explicit, version-pinned action.</p>
    </section>

    <section className={sectionClass}>
      <p className={eyebrowClass}>Test run</p><div className="mt-2 grid grid-cols-[180px_minmax(0,1fr)_auto] gap-2"><select className={inputClass} value={capability} onChange={(event) => setCapability(event.target.value)}>{workflow.metadata.capabilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input className={inputClass} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe an isolated test task…"/><button className={primaryButton} disabled={busy || !prompt.trim() || missingIntegrations.length > 0} type="button" onClick={() => void run()}><Play size={13}/>{busy ? "Working…" : "Run"}</button></div>{error ? <p className="mb-0 mt-2 text-[10px] text-red-300">{error}</p> : null}
    </section>

    <section className={sectionClass}>
      <div className="flex items-center justify-between"><p className={eyebrowClass}>Run history</p><button className={miniButton} type="button" onClick={() => void refreshRuns()}><History size={12}/>Refresh</button></div><div className="mt-2 grid max-h-52 gap-1 overflow-auto">{runs.length ? runs.map((item) => <button className="grid grid-cols-[90px_minmax(0,1fr)_90px] items-center gap-2 rounded-lg border-0 bg-[var(--misty-surface-2)] px-3 py-2 text-left" type="button" key={item.id} onClick={() => void openRun(item.id)}><span className="text-[10px] capitalize">{item.state.replace(/_/g, " ")}</span><span className="truncate text-[10px] text-[var(--misty-text-subtle)]">{item.capability_id} · {item.source_type}</span><span className="text-right text-[9px] text-[var(--misty-text-subtle)]">{item.workflow_version}</span></button>) : <p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">No runs yet.</p>}</div>
    </section>

    {detail ? <RunDetail detail={detail} busy={busy} onClose={() => setDetail(null)} onDecide={decide}/> : null}
    {privateOpen ? <PrivateAgentConversationPanel agent={props.agent} onClose={() => setPrivateOpen(false)}/> : null}
  </div>;
}

function RunDetail({ detail, busy, onClose, onDecide }: { detail: { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] }; busy: boolean; onClose: () => void; onDecide: (approved: boolean) => void }) {
  const approval = detail.approvals.find((item) => item.state === "pending");
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true"><section className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-5"><div className="flex justify-between gap-3"><div><p className={eyebrowClass}>Isolated run</p><h3 className="mb-1 mt-1 text-sm">{detail.run.capability_id} · {detail.run.state}</h3><p className="m-0 text-[10px] text-[var(--misty-text-subtle)]">{detail.run.workflow_identifier}@{detail.run.workflow_version} · {detail.run.id}</p></div><button className={miniButton} type="button" onClick={onClose}><X size={13}/>Close</button></div><div className="mt-4 grid grid-cols-2 gap-3"><RunJSON title="Inputs" value={detail.run.input}/><RunJSON title="Outputs" value={detail.run.outputs}/></div><div className="mt-4 grid gap-2">{detail.actions.map((action) => <div className="rounded-lg bg-[var(--misty-surface-2)] p-3" key={action.id}><p className="m-0 flex items-center gap-1.5 text-xs">{action.destructive ? <AlertTriangle size={13} className="text-amber-300"/> : <ShieldCheck size={13} className="text-emerald-300"/>}{action.summary}</p><p className="mb-0 mt-1 text-[9px] text-[var(--misty-text-subtle)]">{action.action_kind} · {action.state}</p></div>)}</div>{approval ? <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3"><p className="m-0 text-xs text-amber-100">{approval.action_summary}</p><div className="mt-3 flex gap-2"><button className={secondaryButton} disabled={busy} type="button" onClick={() => onDecide(false)}><CircleStop size={13}/>Reject</button><button className={primaryButton} disabled={busy} type="button" onClick={() => onDecide(true)}><Check size={13}/>Approve</button></div></div> : null}</section></div>;
}

function RunJSON({ title, value }: { title: string; value: unknown }) { return <div><p className={eyebrowClass}>{title}</p><pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-black/20 p-3 text-[10px]">{JSON.stringify(value, null, 2)}</pre></div>; }
function Badge({ text, warning = false }: { text: string; warning?: boolean }) { return <span className={`rounded-full px-2 py-1 text-[8px] ${warning ? "bg-amber-500/10 text-amber-200" : "bg-white/5 text-[var(--misty-text-subtle)]"}`}>{text}</span>; }
const sectionClass = "rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4";
const eyebrowClass = "m-0 text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--misty-text-subtle)]";
const inputClass = "min-h-9 min-w-0 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] outline-none";
const primaryButton = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-[11px] text-[var(--misty-primary-contrast)] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[11px] disabled:opacity-50";
const miniButton = "inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 text-[9px]";
