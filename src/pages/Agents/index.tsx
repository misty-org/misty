import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CirclePause,
  CirclePlay,
  Clock3,
  FileOutput,
  FileText,
  FolderOpen,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { MistyFilePicker } from "../../components/MistyFilePicker/MistyFilePicker";
import { errorText } from "../../shared/format";
import { hasTauriInternals } from "../../shared/tauri";
import {
  agentApprovalsForDefinition,
  agentJobsForDefinition,
  useAgentsStore,
} from "../../stores/useAgentsStore";
import type {
  AgentArtifact,
  AgentDefinition,
  AgentWorkflow,
  AgentJobStatus,
  AgentTrigger,
  AgentTriggerKind,
} from "../../agents/types";
import { agentsOpenCitation } from "../../agents/api";
import { AgentSources } from "../../agents/AgentSources";
import { defaultAgentTrustPolicy } from "../../agents/types";
import "../../agents/sources.css";
import "./styles.css";
type WizardState = {
  path: string;
  folderName: string;
  name: string;
  instructions: string;
  triggerKinds: AgentTriggerKind[];
  schedule: string;
  cloudDocumentConsent: boolean;
};
const selectableTriggers: Array<{ kind: AgentTriggerKind; label: string; description: string }> = [
  { kind: "manual", label: "Manual", description: "Run from Misty or a linked integration." },
  { kind: "file_created", label: "New files", description: "Run when a file is added to this folder." },
  { kind: "file_changed", label: "File changes", description: "Run when a file in this folder changes." },
  { kind: "schedule", label: "Schedule", description: "Queue a run on a recurring schedule." },
];
export default function AgentsPage({ spaceId, personalSpaceId, spaceName, initialAgentId }: { spaceId: string; personalSpaceId: string; spaceName: string; initialAgentId?: string }) {
  const { user } = useAuth();
  const snapshot = useAgentsStore((state) => state.snapshot);
  const loading = useAgentsStore((state) => state.loading);
  const saving = useAgentsStore((state) => state.saving);
  const error = useAgentsStore((state) => state.error);
  const syncNotice = useAgentsStore((state) => state.syncNotice);
  const draft = useAgentsStore((state) => state.draft);
  const selectedAgentId = useAgentsStore((state) => state.selectedAgentId);
  const load = useAgentsStore((state) => state.load);
  const selectAgent = useAgentsStore((state) => state.selectAgent);
  const saveDefinition = useAgentsStore((state) => state.saveDefinition);
  const deleteDefinition = useAgentsStore((state) => state.deleteDefinition);
  const resolveApproval = useAgentsStore((state) => state.resolveApproval);
  const cancelJob = useAgentsStore((state) => state.cancelJob);
  const retryJob = useAgentsStore((state) => state.retryJob);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const appliedInitialAgentId = useRef("");
  useEffect(() => { void load(personalSpaceId); }, [load, personalSpaceId]);
  useEffect(() => { if (draft?.spaceId === spaceId) setWizardOpen(true); }, [draft, spaceId]);

  const definitions = useMemo(() => snapshot.definitions.filter((agent) => agent.spaceId === spaceId), [snapshot.definitions, spaceId]);
  useEffect(() => {
    const initial = initialAgentId && definitions.some((agent) => agent.id === initialAgentId) ? initialAgentId : null;
    if (initial && appliedInitialAgentId.current !== initial) {
      appliedInitialAgentId.current = initial;
      selectAgent(initial);
    } else if (!selectedAgentId || !definitions.some((agent) => agent.id === selectedAgentId)) selectAgent(definitions[0]?.id ?? null);
  }, [definitions, initialAgentId, selectAgent, selectedAgentId]);
  const selected = definitions.find((agent) => agent.id === selectedAgentId) ?? null;
  const jobs = selected ? agentJobsForDefinition(snapshot, selected.id) : [];
  const approvals = selected ? agentApprovalsForDefinition(snapshot, selected.id) : [];
  const artifacts = selected ? snapshot.artifacts.filter((artifact) => artifact.agentId === selected.id) : [];
  const definitionIds = useMemo(() => new Set(definitions.map((agent) => agent.id)), [definitions]);
  const pendingCount = snapshot.approvals.filter((approval) => approval.status === "pending" && definitionIds.has(approval.agentId)).length;
  const updateStatus = async (agent: AgentDefinition, status: AgentDefinition["status"]) => {
    setPageError(null);
    try {
      await saveDefinition({ ...agent, status, updatedAt: new Date().toISOString() });
    } catch (nextError) {
      setPageError(errorText(nextError));
    }
  };
  return (
    <main className="agents-page">
      <header className="agents-page-header">
        <div>
          <span className="agents-eyebrow"><Bot size={14} /> {spaceName} Studio</span>
          <h1>Folder agents</h1>
          <p>Give an agent a folder and purpose within this Space.</p>
        </div>
        <div className="agents-header-actions">
          {pendingCount ? <span className="agents-pending-badge">{pendingCount} approval{pendingCount === 1 ? "" : "s"}</span> : null}
          <button className="agents-icon-button" type="button" title="Refresh agents" onClick={() => void load(personalSpaceId)} disabled={loading}>
            <RefreshCcw size={16} className={loading ? "is-spinning" : ""} />
          </button>
          <button className="agents-primary-button" type="button" onClick={() => setWizardOpen(true)}>
            <Plus size={16} /> New agent
          </button>
        </div>
      </header>

      {(pageError || error) ? <div className="agents-banner is-error">{pageError || error}</div> : null}
      {syncNotice ? <div className="agents-banner">{syncNotice}</div> : null}

      <div className="agents-workspace">
        <aside className="agents-list-panel" aria-label="Agents">
          <div className="agents-list-heading">
            <strong>Your agents</strong>
            <span>{definitions.length}</span>
          </div>
          <div className="agents-list">
            {loading && definitions.length === 0 ? (
              <div className="agents-empty"><LoaderCircle className="is-spinning" size={18} /> Loading agents…</div>
            ) : definitions.length === 0 ? (
              <div className="agents-empty">
                <Bot size={28} />
                <strong>No agents yet</strong>
                <span>Create one here or right-click a local folder.</span>
              </div>
            ) : definitions.map((agent) => {
              const activeRuns = snapshot.jobs.filter((job) => job.agentId === agent.id && isActiveJob(job.status)).length;
              const agentApprovals = snapshot.approvals.filter((approval) => approval.agentId === agent.id && approval.status === "pending").length;
              return (
                <button
                  key={agent.id}
                  className={`agents-list-item${agent.id === selectedAgentId ? " is-selected" : ""}`}
                  type="button"
                  onClick={() => selectAgent(agent.id)}
                >
                  <span className={`agents-agent-icon is-${agent.status}`}><Bot size={17} /></span>
                  <span className="agents-list-copy">
                    <strong>{agent.name}</strong>
                    <small><FolderOpen size={11} /> {agent.scope.displayName}</small>
                  </span>
                  <span className="agents-list-meta">
                    {agentApprovals ? <i title="Pending approvals">{agentApprovals}</i> : null}
                    {activeRuns ? <i className="is-active" title="Active runs">{activeRuns}</i> : null}
                    <ChevronRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="agents-detail-panel">
          {selected ? (
            <AgentDetail
              agent={selected}
              spaceId={spaceId}
              jobs={jobs}
              approvals={approvals}
              artifacts={artifacts}
              saving={saving}
              onStatusChange={(status) => void updateStatus(selected, status)}
              onAllowDocumentProcessing={() => void saveDefinition({ ...selected, cloudDocumentConsent: true, updatedAt: new Date().toISOString() }).catch((nextError) => setPageError(errorText(nextError)))}
              onDelete={() => {
                if (!window.confirm(`Delete “${selected.name}”? Run history remains available according to Misty's retention policy.`)) return;
                void deleteDefinition(selected.id).catch((nextError) => setPageError(errorText(nextError)));
              }}
              onResolve={(approvalId, decision) => void resolveApproval(approvalId, decision).catch((nextError) => setPageError(errorText(nextError)))}
              onCancel={(jobId) => void cancelJob(jobId).catch((nextError) => setPageError(errorText(nextError)))}
              onRetry={(jobId) => void retryJob(jobId).catch((nextError) => setPageError(errorText(nextError)))}
            />
          ) : (
            <div className="agents-detail-empty">
              <span><Bot size={34} /></span>
              <h2>Build a folder-aware assistant</h2>
              <p>Mika can summarize documents, react to new files, and queue work even while this device is offline.</p>
              <button className="agents-primary-button" type="button" onClick={() => setWizardOpen(true)}><Plus size={16} /> Create an agent</button>
            </div>
          )}
        </section>
      </div>

      {wizardOpen ? (
        <AgentWizard
          draft={draft?.spaceId === spaceId ? draft : null}
          owner={{ id: user?.id ?? "local-owner", name: user?.name ?? "You", email: user?.email ?? "" }}
          spaceId={spaceId}
          deviceId={snapshot.device?.id ?? "pending-device"}
          saving={saving}
          onClose={() => { useAgentsStore.getState().clearDraft(); setWizardOpen(false); }}
          onSaved={() => setWizardOpen(false)}
        />
      ) : null}
    </main>
  );
}

function AgentDetail(props: {
  agent: AgentDefinition;
  spaceId: string;
  jobs: ReturnType<typeof agentJobsForDefinition>;
  approvals: ReturnType<typeof agentApprovalsForDefinition>;
  artifacts: AgentArtifact[];
  saving: boolean;
  onStatusChange: (status: AgentDefinition["status"]) => void;
  onAllowDocumentProcessing: () => void;
  onDelete: () => void;
  onResolve: (approvalId: string, decision: "approved" | "denied") => void;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
}) {
  const pendingApprovals = props.approvals.filter((approval) => approval.status === "pending");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const readsDocuments = props.agent.workflow.nodes.some((node) => node.kind === "document_read" || node.kind === "document_ocr");
  return (
    <div className="agents-detail">
      <header className="agents-detail-header">
        <div className={`agents-hero-icon is-${props.agent.status}`}><Bot size={26} /></div>
        <div className="agents-detail-title">
          <div className="agents-title-row"><h2>{props.agent.name}</h2><span className={`agents-status is-${props.agent.status}`}>{props.agent.status}</span></div>
          <p><FolderOpen size={13} /> {props.agent.scope.displayName} · device-scoped</p>
        </div>
        <div className="agents-detail-actions">
			<Link className="agents-secondary-button" to={`/spaces/${encodeURIComponent(props.spaceId)}/studio/folder-agents?agentId=${encodeURIComponent(props.agent.id)}`}>Edit workflow</Link>
          {props.agent.status === "enabled" ? (
            <button className="agents-secondary-button" type="button" disabled={props.saving} onClick={() => props.onStatusChange("disabled")}><CirclePause size={15} /> Disable</button>
          ) : (
            <button className="agents-primary-button" type="button" disabled={props.saving} onClick={() => props.onStatusChange("enabled")}><CirclePlay size={15} /> Enable</button>
          )}
          <button className="agents-icon-button is-danger" type="button" title="Delete agent" disabled={props.saving} onClick={props.onDelete}><Trash2 size={16} /></button>
        </div>
      </header>

      <section className="agents-instructions-card">
        <span>Instructions</span>
        <p>{props.agent.instructions}</p>
      </section>

      {readsDocuments && !props.agent.cloudDocumentConsent ? (
        <section className="agents-document-warning">
          <div><ShieldCheck size={17} /><div><strong>Document processing is off</strong><p>Mika can detect new files, but cannot read or summarize them until you allow secure cloud processing. Uploaded document data is deleted after 24 hours.</p></div></div>
          <button className="agents-primary-button" type="button" disabled={props.saving} onClick={props.onAllowDocumentProcessing}>Allow document processing</button>
        </section>
      ) : null}

      <div className="agents-summary-grid">
        <section><span><CalendarClock size={14} /> Triggers</span><strong>{props.agent.triggers.filter((trigger) => trigger.enabled).map(triggerLabel).join(", ") || "Manual only"}</strong></section>
        <section><span><ShieldCheck size={14} /> Access</span><strong>Inherited from Space</strong></section>
        <section><span><ShieldCheck size={14} /> Trust</span><strong>Writes require approval</strong></section>
      </div>
      {props.agent.triggers.filter((trigger) => trigger.enabled && trigger.kind === "local_webhook" && trigger.webhookId).map((trigger) => (
        <section className="agents-instructions-card" key={trigger.id}>
          <span>Local webhook</span>
          <p>This legacy trigger is currently unavailable. You can remove it in the workflow editor.</p>
        </section>
      ))}

      <section className="agents-section">
        <header><div><ShieldCheck size={16} /><strong>Approvals</strong></div><span>{pendingApprovals.length} pending</span></header>
        <div className="agents-approval-list">
          {pendingApprovals.length === 0 ? <div className="agents-section-empty"><Check size={15} /> Nothing needs your approval.</div> : pendingApprovals.map((approval) => (
            <article key={approval.id} className="agents-approval-card">
              <span className="agents-approval-icon"><FileOutput size={16} /></span>
              <div>
                <strong>{approval.action.summary}</strong>
                <p>{approval.action.relativePaths.join(", ") || props.agent.scope.displayName}</p>
                <small>Expires {formatDate(approval.expiresAt)}</small>
              </div>
              <div className="agents-approval-actions">
                <button type="button" onClick={() => props.onResolve(approval.id, "denied")}>Deny</button>
                <button className="is-approve" type="button" onClick={() => props.onResolve(approval.id, "approved")}>Approve</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="agents-section agents-history-section">
        <header><div><History size={16} /><strong>Run history</strong></div><span>{props.jobs.length} runs</span></header>
        <div className="agents-run-list">
          {props.jobs.length === 0 ? <div className="agents-section-empty"><Clock3 size={15} /> Runs will appear here.</div> : props.jobs.slice(0, 20).map((job) => {
            const artifacts = props.artifacts.filter((artifact) => artifact.jobId === job.id);
            const hasResult = Boolean(job.result?.answer || artifacts.length || job.error);
            const expanded = expandedJobId === job.id;
            return (
              <article key={job.id} className={`agents-run-item${expanded ? " is-expanded" : ""}`}>
                <div className="agents-run-row">
                  <span className={`agents-run-dot is-${job.status}`} />
                  <div>
                    <strong>{job.statusMessage || job.result?.answer || job.prompt || `${triggerLabel({ kind: job.triggerKind } as AgentTrigger)} run`}</strong>
                    <small>{formatDate(job.createdAt)} · {job.triggerKind.replace(/_/g, " ")}</small>
                  </div>
                  {typeof job.progress === "number" && isActiveJob(job.status) ? <progress value={job.progress} max={1} /> : null}
                  <span className={`agents-run-status is-${job.status}`}>{job.status.replace("_", " ")}</span>
                  <div className="agents-run-actions">
                    {job.status === "failed" ? <button type="button" disabled={props.saving} onClick={() => props.onRetry(job.id)}><RefreshCcw size={12} /> Retry</button> : null}
                    {isActiveJob(job.status) ? <button type="button" disabled={props.saving} onClick={() => props.onCancel(job.id)}>Cancel</button> : hasResult ? (
                      <button type="button" onClick={() => setExpandedJobId(expanded ? null : job.id)}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? "Hide" : "View result"}</button>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                  <div className="agents-run-result">
                    <header><strong>Mika’s result</strong>{typeof job.result?.creditsUsed === "number" ? <span>{job.result.creditsUsed.toLocaleString()} credits</span> : null}</header>
                    {job.result?.answer ? <p>{job.result.answer}</p> : null}
                    {job.error ? <p className="is-error">{job.error}</p> : null}
                    {job.result?.citations?.length ? <AgentSources citations={job.result.citations} compact /> : null}
                    {artifacts.length ? (
                      <div className="agents-run-artifacts">
                        <strong>Generated files</strong>
                        {artifacts.map((artifact) => (
                          <button type="button" key={artifact.id} onClick={() => void openAgentArtifact(artifact)}><FileText size={14} /><span>{artifact.fileName}</span><small>{artifact.relativePath}</small></button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

async function openAgentArtifact(artifact: AgentArtifact): Promise<void> {
  await agentsOpenCitation({
    citation: {
      id: `artifact-source-${artifact.id}`,
      artifactId: artifact.id,
      scopeId: artifact.scopeId,
      fileName: artifact.fileName,
      relativePath: artifact.relativePath,
      kind: "section",
      label: "Generated summary",
    },
  });
}

function AgentWizard(props: {
  draft: { localPath: string; displayName: string; spaceId: string } | null;
  owner: { id: string; name: string; email: string };
  spaceId: string;
  deviceId: string;
  saving: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const registerFolderScope = useAgentsStore((state) => state.registerFolderScope);
  const saveDefinition = useAgentsStore((state) => state.saveDefinition);
  const [form, setForm] = useState<WizardState>(() => ({
    path: props.draft?.localPath ?? "",
    folderName: props.draft?.displayName ?? "",
    name: props.draft?.displayName ? `${props.draft.displayName} agent` : "",
    instructions: "",
    triggerKinds: ["manual"],
    schedule: "0 9 * * 1-5",
    cloudDocumentConsent: false,
  }));
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const canSave = Boolean(form.path.trim() && form.name.trim() && form.instructions.trim() && form.triggerKinds.length);
  const workflowSteps = useMemo(() => {
    const steps = ["Read documents in folder", "Ask Mika using managed cloud models", "Create a new result without overwriting"];
    if (form.triggerKinds.includes("file_created") || form.triggerKinds.includes("file_changed")) steps.unshift("Watch for matching file events");
    return steps;
  }, [form.triggerKinds]);

  const toggleTrigger = (kind: AgentTriggerKind) => {
    setForm((current) => ({
      ...current,
      triggerKinds: current.triggerKinds.includes(kind)
        ? current.triggerKinds.filter((value) => value !== kind)
        : [...current.triggerKinds, kind],
    }));
  };

  const save = async () => {
    if (!canSave) return;
    setWizardError(null);
    try {
      const scope = await registerFolderScope(form.path.trim(), form.folderName || "Folder");
      const now = new Date().toISOString();
      const definition: AgentDefinition = {
        id: makeId("agent"),
        spaceId: props.spaceId,
        ownerAccountId: props.owner.id,
        deviceId: scope.deviceId || props.deviceId,
        scope,
        name: form.name.trim(),
        instructions: form.instructions.trim(),
        status: "draft",
        cloudDocumentConsent: form.cloudDocumentConsent,
        members: [
          { accountId: props.owner.id, displayName: props.owner.name, email: props.owner.email || null, role: "owner", status: "active" },
        ],
        triggers: form.triggerKinds.map((kind) => ({
          id: makeId("trigger"),
          kind,
          enabled: true,
          schedule: kind === "schedule" ? form.schedule.trim() || "0 9 * * 1-5" : null,
          webhookId: kind === "local_webhook" ? makeId("hook") : null,
        })),
        trustPolicy: defaultAgentTrustPolicy(),
        workflowId: null,
        workflow: workflowForAgent(form.triggerKinds, form.schedule),
        workflowRevision: 1,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await saveDefinition(definition);
      props.onSaved();
    } catch (nextError) {
      setWizardError(errorText(nextError));
    }
  };

  return (
    <div className="agents-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="agents-wizard" role="dialog" aria-modal="true" aria-labelledby="agent-wizard-title">
        <header className="agents-wizard-header">
          <div><span className="agents-wizard-icon"><Bot size={19} /></span><div><h2 id="agent-wizard-title">Create Mika Agent</h2><p>Review this setup before the agent can be enabled.</p></div></div>
          <button className="agents-icon-button" type="button" aria-label="Close" onClick={props.onClose}><X size={17} /></button>
        </header>
        <div className="agents-wizard-body">
          {wizardError ? <div className="agents-banner is-error">{wizardError}</div> : null}
          <div className="agents-form-row is-folder">
            <label>Folder</label>
            <div className="agents-folder-field"><FolderOpen size={15} /><span title={form.path}>{form.path || "Choose a local folder"}</span><button type="button" onClick={() => setFolderPickerOpen(true)}>Choose</button></div>
            {!hasTauriInternals() ? <input value={form.path} placeholder="Folder path (browser preview)" onChange={(event) => setForm((current) => ({ ...current, path: event.target.value, folderName: baseName(event.target.value) }))} /> : null}
          </div>
          <div className="agents-form-row">
            <label htmlFor="agent-name">Name</label>
            <input id="agent-name" value={form.name} placeholder="Quarterly reports agent" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="agents-form-row">
            <label htmlFor="agent-instructions">What should Mika do?</label>
            <textarea id="agent-instructions" value={form.instructions} placeholder="When a report arrives, summarize the key findings and create a concise Markdown brief with page citations." onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} />
          </div>
          <div className="agents-form-row">
            <label>Start this agent</label>
            <div className="agents-trigger-grid">
              {selectableTriggers.map((trigger) => {
                const selected = form.triggerKinds.includes(trigger.kind);
                return <button key={trigger.kind} className={selected ? "is-selected" : ""} type="button" aria-pressed={selected} onClick={() => toggleTrigger(trigger.kind)}><span>{selected ? <Check size={13} /> : null}</span><strong>{trigger.label}</strong><small>{trigger.description}</small></button>;
              })}
            </div>
            {form.triggerKinds.includes("schedule") ? <input aria-label="Schedule" value={form.schedule} placeholder="Cron schedule" onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} /> : null}
          </div>
          <div className="agents-form-row">
            <label>Access</label>
            <small>This agent belongs to the current Space. Its visibility, configuration access, and run permissions are inherited from the Space.</small>
          </div>
          <section className="agents-workflow-preview">
			<header><div><MessageSquare size={15} /><strong>Workflow draft</strong></div><span>Advanced editor available after save</span><span>Revision 1</span></header>
            <ol>{workflowSteps.map((step) => <li key={step}><span>{step}</span></li>)}</ol>
          </section>
          <section className="agents-trust-summary">
            <header><ShieldCheck size={17} /><div><strong>Trust summary</strong><p>Misty enforces these permissions from typed workflow steps, not from the instructions above.</p></div></header>
            <div><span><Check size={13} /> Automatic</span><p>Read, search, summarize, notify you, and create a new collision-free file.</p></div>
            <div><span><Clock3 size={13} /> Ask first</span><p>Overwrite, rename, move, delete, change permissions, webhooks, and unsolicited external messages.</p></div>
            <label className="agents-consent"><input type="checkbox" checked={form.cloudDocumentConsent} onChange={(event) => setForm((current) => ({ ...current, cloudDocumentConsent: event.target.checked }))} /><span>I understand that selected documents are securely uploaded to Misty for cloud OCR and inference, then deleted after 24 hours.</span></label>
          </section>
        </div>
        <footer className="agents-wizard-footer">
          <span>{form.cloudDocumentConsent ? "The agent will be saved as a draft. Enable it after review." : "You can save now. Cloud document processing stays off until you consent."}</span>
          <div><button className="agents-secondary-button" type="button" onClick={props.onClose}>Cancel</button><button className="agents-primary-button" type="button" disabled={!canSave || props.saving} onClick={() => void save()}>{props.saving ? <LoaderCircle className="is-spinning" size={15} /> : <Bot size={15} />} Save draft</button></div>
        </footer>
      </section>
      {folderPickerOpen ? (
        <MistyFilePicker
          mode="folder"
          title="Choose a folder for Mika"
          initialPath={form.path}
          onCancel={() => setFolderPickerOpen(false)}
          onSelect={(path) => {
            setForm((current) => ({ ...current, path, folderName: baseName(path) }));
            setFolderPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function workflowForAgent(triggerKinds: AgentTriggerKind[], schedule: string): AgentWorkflow {
  const triggerNodes = triggerKinds.map((kind) => ({
    id: `trigger-${kind}`,
    kind: ({
      manual: "manual_trigger",
      schedule: "schedule_trigger",
      file_created: "file_event",
      file_changed: "file_event",
      local_webhook: "local_webhook",
    } as const)[kind],
    config: kind === "schedule" ? { schedule } : kind.startsWith("file_") ? { event: kind } : {},
    policy: [] as AgentWorkflow["nodes"][number]["policy"],
  }));
  const taskNodes: AgentWorkflow["nodes"] = [
    { id: "folder-query", kind: "folder_query", config: { maxDocuments: 10 }, policy: [{ action: "search", mode: "automatic" }] },
    { id: "document-read", kind: "document_read", config: { ocrFallback: true }, policy: [{ action: "read", mode: "automatic" }] },
    { id: "mika-task", kind: "mika_task", config: { serverModelSelection: true }, policy: [{ action: "summarize", mode: "automatic" }] },
    { id: "artifact-create", kind: "artifact_create", config: { collisionPolicy: "create_new" }, policy: [{ action: "create_file", mode: "automatic" }] },
    { id: "approval", kind: "approval", config: { expiresHours: 24 }, policy: [
      { action: "overwrite", mode: "approval" }, { action: "rename", mode: "approval" },
      { action: "move", mode: "approval" }, { action: "delete", mode: "approval" },
      { action: "change_permissions", mode: "approval" }, { action: "outbound_webhook", mode: "approval" },
    ] },
  ];
  return {
    version: 1,
    revision: 1,
    nodes: [...triggerNodes, ...taskNodes],
    edges: [
      ...triggerNodes.map((node) => ({ from: node.id, to: "folder-query" })),
      { from: "folder-query", to: "document-read" },
      { from: "document-read", to: "mika-task" },
      { from: "mika-task", to: "artifact-create" },
    ],
  };
}

function triggerLabel(trigger: AgentTrigger): string {
  if (trigger.kind === "file_created") return "New files";
  if (trigger.kind === "file_changed") return "File changes";
  return trigger.kind[0].toUpperCase() + trigger.kind.slice(1);
}

function isActiveJob(status: AgentJobStatus): boolean {
  return status === "queued" || status === "leased" || status === "running" || status === "awaiting_approval";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function makeId(prefix: string): string {
  return `${prefix}_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "Folder";
}
