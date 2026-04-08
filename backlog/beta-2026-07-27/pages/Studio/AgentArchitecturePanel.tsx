import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleStop,
  History,
  LockKeyhole,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import type {
  AgentInstanceRecord,
  PublishedAgentVersion,
  RunAction,
  RunApproval,
  SpaceIntegration,
  SpaceRun,
  WorkflowVersion,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceStudioResource } from "@/models/interfaces/features/spaces/types";
import { errorText } from "@/lib/format";
import { openProviderAuthorizationLink } from "@/platform/openExternalLink";
import { AgentConversationPanel } from "./AgentConversation";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/ui";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Badge } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { EmptyState } from "@/ui";
import { PrimitiveIconButton as IconButton } from "@/ui";
import { StatusBadge } from "@/ui";

export function AgentArchitecturePanel(props: {
  agent: SpaceStudioResource;
  spaceName: string;
  workflows: SpaceStudioResource[];
  canManage: boolean;
  canRun: boolean;
  initialRunId?: string;
  onAgentUpdated: (agent: SpaceStudioResource) => void;
}) {
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
  const [selectedPackage, setSelectedPackage] = useState(
    props.agent.active_workflow?.workflow_id ?? props.workflows[0]?.id ?? "",
  );
  const [selectedVersion, setSelectedVersion] = useState(props.agent.active_workflow?.id ?? "");
  const [capability, setCapability] = useState("chat");
  const [prompt, setPrompt] = useState("");
  const [detail, setDetail] = useState<{
    run: SpaceRun;
    actions: RunAction[];
    approvals: RunApproval[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateOpen, setPrivateOpen] = useState(false);
  const [integrationProvider, setIntegrationProvider] = useState("");
  const [scheduleExpression, setScheduleExpression] = useState("0 9 * * 1-5");
  const [scheduleTimezone, setScheduleTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const runDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const privateChatReturnFocusRef = useRef<HTMLElement | null>(null);
  const integrationDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const openedInitialRunRef = useRef("");
  const closeIntegrationDialog = () => {
    if (busy) return;
    setIntegrationProvider("");
  };
  const attachedWorkflows = availableWorkflowVersions.filter((item) =>
    attachedVersionIds.includes(item.id),
  );
  const capabilities = useMemo(
    () => [
      { id: "chat", name: "Ordinary chat" },
      ...attachedWorkflows.flatMap((item) =>
        item.metadata.capabilities.map((entry) => ({
          id: entry.id,
          name: `${item.name} · ${entry.name}`,
        })),
      ),
    ],
    [attachedWorkflows],
  );

  const refreshRuns = async () => {
    const [{ runs: nextRuns }, { integrations: nextIntegrations }] = await Promise.all([
      agentArchitectureApi.runs(props.agent.space_id, props.agent.id),
      agentArchitectureApi.integrations(props.agent.space_id),
    ]);
    setRuns(nextRuns);
    setIntegrations(nextIntegrations);
  };
  const loadVersions = async (workflowId: string) => {
    if (!workflowId) {
      setVersions([]);
      return;
    }
    const response = await agentArchitectureApi.workflowVersions(props.agent.space_id, workflowId);
    setVersions(response.versions);
    setSelectedVersion((current) =>
      response.versions.some((item) => item.id === current)
        ? current
        : (response.versions[0]?.id ?? ""),
    );
  };
  const refreshDefinition = async () => {
    const versionLists = await Promise.all(
      props.workflows.map((item) =>
        agentArchitectureApi.workflowVersions(props.agent.space_id, item.id),
      ),
    );
    const flattened = versionLists.flatMap((item) => item.versions);
    const [{ versions: agentVersions }, nextInstance] = await Promise.all([
      agentArchitectureApi.agentVersions(props.agent.space_id, props.agent.id),
      canExecute
        ? agentArchitectureApi.agentInstance(props.agent.space_id, props.agent.id).catch(() => null)
        : Promise.resolve(null),
    ]);
    setAvailableWorkflowVersions(flattened);
    setPublishedVersions(agentVersions);
    setInstance(nextInstance);
    if (agentVersions[0])
      setAttachedVersionIds(
        agentVersions[0].workflows
          .filter((item) => item.enabled)
          .map((item) => item.workflow_version_id),
      );
  };

  useEffect(() => {
    void refreshRuns().catch((reason) => setError(errorText(reason)));
  }, [props.agent.id, props.agent.space_id]);
  useEffect(() => {
    void refreshDefinition().catch((reason) => setError(errorText(reason)));
  }, [
    props.agent.id,
    props.agent.space_id,
    props.workflows.map((item) => `${item.id}:${item.version}`).join("|"),
  ]);
  useEffect(() => {
    void loadVersions(selectedPackage).catch((reason) => setError(errorText(reason)));
  }, [props.agent.space_id, selectedPackage]);
  useEffect(() => {
    if (!capabilities.some((item) => item.id === capability)) setCapability("chat");
  }, [capabilities, capability]);
  useEffect(() => {
    if (!props.initialRunId || openedInitialRunRef.current === props.initialRunId) return;
    openedInitialRunRef.current = props.initialRunId;
    void openRun(props.initialRunId);
  }, [props.initialRunId]);

  const availableIntegrations = useMemo(
    () =>
      new Set(integrations.filter((item) => item.status === "active").map((item) => item.provider)),
    [integrations],
  );
  const missingIntegrations = attachedWorkflows
    .flatMap((item) => item.metadata.requiredIntegrations)
    .filter((item, index, all) => !availableIntegrations.has(item) && all.indexOf(item) === index);

  const run = async () => {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const response = await agentArchitectureApi.run(props.agent.space_id, props.agent.id, {
        prompt: text,
        capability_id: capability,
        input: { prompt: text },
      });
      if ("id" in response) await openRun(response.id, runButtonRef.current);
      else if ("run" in response && response.run)
        await openRun(response.run.id, runButtonRef.current);
      else if ("routing" in response)
        setError(response.routing.question || "Choose a capability before running this agent.");
      await refreshRuns();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const publishAttachments = async () => {
    if (
      !attachedVersionIds.length &&
      !window.confirm("Publish this Agent without workflows? It will still support ordinary chat.")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await agentArchitectureApi.publishAgentVersion(
        props.agent.space_id,
        props.agent.id,
        attachedVersionIds.map((workflowVersionId, position) => ({
          workflow_version_id: workflowVersionId,
          alias: `workflow-${position + 1}`,
          enabled: true,
          position,
        })),
      );
      await refreshDefinition();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const addAttachment = () => {
    if (selectedVersion && !attachedVersionIds.includes(selectedVersion))
      setAttachedVersionIds((current) => [...current, selectedVersion]);
  };
  const updateInstance = async () => {
    if (!instance) return;
    setBusy(true);
    setError("");
    try {
      setInstance(
        await agentArchitectureApi.updateAgentInstance(props.agent.space_id, props.agent.id),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const setAutomationEnabled = async (workflowVersionId: string, enabled: boolean) => {
    if (!instance) return;
    setBusy(true);
    setError("");
    try {
      const workflow = attachedWorkflows.find((item) => item.id === workflowVersionId);
      const hasCron = workflowDefinitionHasNode(workflow?.definition, "cron_trigger");
      const capabilityId = workflow?.metadata.capabilities[0]?.id ?? "";
      const triggerConfig = hasCron
        ? {
            kind: "cron",
            expression: scheduleExpression.trim(),
            timezone: scheduleTimezone,
            capabilityId,
          }
        : { kind: "event", capabilityId };
      await agentArchitectureApi.configureInstanceWorkflow(instance.id, workflowVersionId, {
        enabled,
        trigger_config: triggerConfig,
        consent: {
          granted: enabled,
          reviewed_at: new Date().toISOString(),
          preauthorizedWrites: enabled
            ? workflowPreauthorizedWrites(workflow?.definition, instance.connection_bindings)
            : [],
        },
      });
      setInstance(await agentArchitectureApi.agentInstance(props.agent.space_id, props.agent.id));
      setError(
        enabled
          ? "Automation enabled for your Space Agent."
          : "Automation disabled for your Space Agent.",
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const connectIntegration = async () => {
    if (!integrationProvider) return;
    setBusy(true);
    setError("");
    try {
      const started = await agentArchitectureApi.beginProviderConnection(
        props.agent.space_id,
        integrationProvider,
        window.location.pathname,
      );
      await openProviderAuthorizationLink(started.authorization_url);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const openRun = async (id: string, returnFocus?: HTMLElement | null) => {
    if (returnFocus) runDialogReturnFocusRef.current = returnFocus;
    try {
      setDetail(await agentArchitectureApi.runDetail(id));
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const decide = async (approved: boolean) => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await agentArchitectureApi.decideRun(detail.run.id, approved);
      await openRun(detail.run.id);
      await refreshRuns();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await agentArchitectureApi.cancelRun(detail.run.id);
      await openRun(detail.run.id);
      await refreshRuns();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const next = await agentArchitectureApi.retryRun(detail.run.id);
      await openRun(next.id);
      await refreshRuns();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrowClass}>Your use of this Space Agent</p>
            <h3 className="mb-1 mt-1 text-sm">
              {instance?.status === "running" ? "Running" : "Idle"}{" "}
              <span className="font-normal text-muted-foreground">
                · your history, memory, credentials, cursors, and approvals stay isolated
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Pinned Agent version:{" "}
              {publishedVersions.find((item) => item.id === instance?.agent_version_id)?.version ??
                "not initialized"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {instance?.update_available ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || instance.status !== "idle"}
                type="button"
                onClick={() => void updateInstance()}
              >
                <RefreshCcw />
                Update Agent
              </Button>
            ) : null}
            {canExecute ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={(event) => {
                  privateChatReturnFocusRef.current = event.currentTarget;
                  setPrivateOpen(true);
                }}
              >
                <LockKeyhole />
                Chat with Agent
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 rounded-md bg-muted/40 p-3">
          <strong className="text-xs">Ordinary chat</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            Always available without a workflow. Mika can use tools granted through this user’s
            connections and permissions.
          </p>
        </div>
        <div className="mt-3 grid gap-2">
          {attachedWorkflows.map((attached) => {
            const configured = instance?.workflows?.find(
              (item) => item.workflow_version_id === attached.id,
            );
            const scheduled = workflowDefinitionHasNode(attached.definition, "cron_trigger");
            return (
              <article className="rounded-md bg-muted/40 p-3" key={attached.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-xs">{attached.name}</strong>
                    <StatusBadge
                      className="ml-2 capitalize"
                      status={configured?.enabled ? "success" : "neutral"}
                      dot
                    >
                      {attached.version} · {configured?.enabled ? "enabled" : "disabled"}
                    </StatusBadge>
                  </div>
                  {instance ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || configured?.enabled}
                        onClick={() => void setAutomationEnabled(attached.id, true)}
                      >
                        Enable for me
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !configured?.enabled}
                        onClick={() => void setAutomationEnabled(attached.id, false)}
                      >
                        Disable
                      </Button>
                    </div>
                  ) : null}
                </div>
                {scheduled ? (
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
                    <Input
                      className="h-9 text-xs"
                      value={scheduleExpression}
                      onChange={(event) => setScheduleExpression(event.target.value)}
                      aria-label={`${attached.name} cron expression`}
                      placeholder="0 9 * * 1-5"
                    />
                    <Input
                      className="h-9 text-xs"
                      value={scheduleTimezone}
                      onChange={(event) => setScheduleTimezone(event.target.value)}
                      aria-label={`${attached.name} timezone`}
                      placeholder="America/Los_Angeles"
                    />
                  </div>
                ) : null}
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {attached.metadata.capabilities.map((item) => item.name).join(", ")} · users
                  configure triggers, connections, and consent independently
                </p>
              </article>
            );
          })}
        </div>
        {!attachedWorkflows.length ? (
          <Alert className="mt-3 border-[color-mix(in_srgb,var(--misty-warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--misty-warning)_8%,var(--card))]">
            <AlertTriangle />
            <AlertTitle>No workflows are attached</AlertTitle>
            <AlertDescription>This Agent still works through ordinary chat.</AlertDescription>
          </Alert>
        ) : null}
        {missingIntegrations.length ? (
          <Alert className="mt-3 border-[color-mix(in_srgb,var(--misty-warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--misty-warning)_8%,var(--card))]">
            <AlertTriangle />
            <AlertTitle>Provider connections required</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>Connect these providers for your use of this Agent:</span>
              {canExecute ? (
                missingIntegrations.map((provider) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    type="button"
                    key={provider}
                    onClick={(event) => {
                      integrationDialogReturnFocusRef.current = event.currentTarget;
                      setIntegrationProvider(provider);
                    }}
                  >
                    Connect {provider}
                  </Button>
                ))
              ) : (
                <span>You need permission to run Agents.</span>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className={sectionClass}>
        <p className={eyebrowClass}>Version-pinned workflow attachments</p>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <Select
            disabled={!canEditDefinition}
            value={selectedPackage || "none"}
            onValueChange={(value) => setSelectedPackage(value === "none" ? "" : value)}
          >
            <SelectTrigger aria-label="Workflow package">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose workflow…</SelectItem>
              {props.workflows.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            disabled={!canEditDefinition}
            value={selectedVersion || "none"}
            onValueChange={(value) => setSelectedVersion(value === "none" ? "" : value)}
          >
            <SelectTrigger aria-label="Workflow version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose version…</SelectItem>
              {versions.map((item) => (
                <SelectItem value={item.id} key={item.id}>
                  {item.version} · {item.author_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !canEditDefinition ||
              busy ||
              !selectedVersion ||
              attachedVersionIds.includes(selectedVersion)
            }
            type="button"
            onClick={addAttachment}
          >
            <Plus />
            Attach
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {attachedVersionIds.map((versionId) => {
            const item = availableWorkflowVersions.find((candidate) => candidate.id === versionId);
            return (
              <Badge variant="secondary" className="gap-1 font-normal" key={versionId}>
                {item?.name ?? versionId}@{item?.version}
                <IconButton
                  className="size-5"
                  label={`Remove ${item?.name ?? versionId}`}
                  tooltip={false}
                  disabled={!canEditDefinition}
                  onClick={() =>
                    setAttachedVersionIds((current) => current.filter((id) => id !== versionId))
                  }
                >
                  <X />
                </IconButton>
              </Badge>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Only the Agent creator can publish. Existing user instances stay pinned until each user
            updates while idle; expanded capabilities require renewed consent.
          </p>
          <Button
            size="sm"
            disabled={!canEditDefinition || busy}
            type="button"
            onClick={() => void publishAttachments()}
          >
            <RefreshCcw />
            Publish Agent version
          </Button>
        </div>
      </section>

      <section className={sectionClass}>
        <p className={eyebrowClass}>Test run</p>
        {canExecute ? (
          <div className="mt-2 grid grid-cols-[220px_minmax(0,1fr)_auto] gap-2">
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger aria-label="Agent test capability">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {capabilities.map((item) => (
                  <SelectItem value={item.id} key={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-9 text-xs"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask normally or invoke a pinned workflow…"
              aria-label="Agent test prompt"
            />
            <Button
              ref={runButtonRef}
              size="sm"
              disabled={
                busy || !prompt.trim() || (capability !== "chat" && missingIntegrations.length > 0)
              }
              type="button"
              onClick={() => void run()}
            >
              <Play />
              {busy ? "Working…" : "Run"}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {!props.canRun
              ? "You do not have permission to run Agents in this Space."
              : props.agent.enabled
                ? "This Agent is currently unavailable on its runtime."
                : "Enable and publish this Agent before starting a run or conversation."}
          </p>
        )}
        {error ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>Agent run error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className={sectionClass}>
        <div className="flex items-center justify-between">
          <p className={eyebrowClass}>Run history</p>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => void refreshRuns().catch((reason) => setError(errorText(reason)))}
          >
            <History />
            Refresh
          </Button>
        </div>
        <div className="mt-2 grid max-h-52 gap-1 overflow-auto">
          {runs.length ? (
            runs.map((item) => (
              <Button
                variant="ghost"
                className="grid h-auto grid-cols-[auto_minmax(0,1fr)_90px] items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-left"
                type="button"
                key={item.id}
                onClick={(event) => void openRun(item.id, event.currentTarget)}
              >
                <StatusBadge status={runStatus(item.state)} className="capitalize">
                  {item.state.replace(/_/g, " ")}
                </StatusBadge>
                <span className="truncate text-xs text-muted-foreground">
                  {item.capability_id} · {item.source_type}
                </span>
                <span className="text-right text-[10px] text-muted-foreground">
                  {item.workflow_version}
                </span>
              </Button>
            ))
          ) : (
            <EmptyState
              compact
              title="No runs yet"
              description="Runs started with this Agent will appear here."
            />
          )}
        </div>
      </section>

      {detail ? (
        <RunDetailDialog
          detail={detail}
          resourceName={props.agent.name}
          spaceName={props.spaceName}
          busy={busy}
          canRetry={canExecute}
          operationError={error}
          returnFocusRef={runDialogReturnFocusRef}
          onClose={() => setDetail(null)}
          onDecide={decide}
          onCancel={cancel}
          onRetry={retry}
        />
      ) : null}
      {privateOpen ? (
        <AgentConversationPanel
          agent={props.agent}
          returnFocusRef={privateChatReturnFocusRef}
          onClose={() => setPrivateOpen(false)}
        />
      ) : null}
      <Dialog
        open={Boolean(integrationProvider)}
        onOpenChange={(open) => {
          if (!open) closeIntegrationDialog();
        }}
      >
        <DialogContent
          className="max-w-md"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (integrationDialogReturnFocusRef.current) {
              event.preventDefault();
              integrationDialogReturnFocusRef.current.focus();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connectIntegration();
            }}
          >
            <DialogHeader>
              <Badge variant="secondary" className="mb-1 w-fit">
                Private provider connection
              </Badge>
              <DialogTitle>Connect {integrationProvider}</DialogTitle>
              <DialogDescription>
                Misty will open the provider’s official authorization screen. Tokens are encrypted
                server-side and remain private to your Agent instance.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-5">
              <Button
                variant="ghost"
                disabled={busy}
                type="button"
                onClick={closeIntegrationDialog}
              >
                Cancel
              </Button>
              <Button data-dialog-autofocus disabled={busy} type="submit">
                {busy ? "Opening…" : "Continue to provider"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RunDetailDialog({
  detail,
  resourceName,
  spaceName,
  busy,
  canRetry = true,
  operationError = "",
  returnFocusRef,
  onClose,
  onDecide,
  onCancel,
  onRetry,
}: {
  detail: { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] };
  resourceName: string;
  spaceName: string;
  busy: boolean;
  canRetry?: boolean;
  operationError?: string;
  returnFocusRef?: { current: HTMLElement | null };
  onClose: () => void;
  onDecide: (approved: boolean) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const approval = detail.approvals.find((item) => item.state === "pending");
  const cancelable = ["queued", "running", "cooldown", "awaiting_approval"].includes(
    detail.run.state,
  );
  const retryable =
    canRetry &&
    (detail.run.state === "failed" ||
      detail.run.state === "canceled" ||
      detail.run.state === "completed_with_errors");
  const runError = operationError || detail.run.error_message;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85vh] max-w-2xl overflow-auto"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <Badge variant="secondary" className="w-fit">
            Isolated run · {spaceName}
          </Badge>
          <DialogTitle>
            {resourceName} · {detail.run.capability_id}
          </DialogTitle>
          <DialogDescription>
            {detail.run.workflow_identifier}@{detail.run.workflow_version} · {detail.run.id}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={runStatus(detail.run.state)} dot className="capitalize">
            {detail.run.state.replace(/_/g, " ")}
          </StatusBadge>
          <div className="ml-auto flex gap-2">
            {cancelable ? (
              <Button variant="outline" size="sm" disabled={busy} type="button" onClick={onCancel}>
                <CircleStop />
                Cancel
              </Button>
            ) : null}
            {retryable ? (
              <Button variant="outline" size="sm" disabled={busy} type="button" onClick={onRetry}>
                <RefreshCcw />
                Retry
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RunJSON title="Inputs" value={detail.run.input} />
          <RunJSON title="Outputs" value={detail.run.outputs} />
        </div>
        {runError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Run error</AlertTitle>
            <AlertDescription>{runError}</AlertDescription>
          </Alert>
        ) : null}
        {detail.actions.length ? (
          <div className="grid gap-1">
            {detail.actions.map((action) => (
              <div className="rounded-md bg-muted/40 p-3" key={action.id}>
                <p className="flex items-center gap-1.5 text-xs">
                  {action.destructive ? (
                    <AlertTriangle className="text-[var(--misty-warning)]" />
                  ) : (
                    <ShieldCheck className="text-[var(--misty-success)]" />
                  )}
                  {action.summary}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {action.action_kind} · {action.state}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {approval ? (
          <Alert className="border-[color-mix(in_srgb,var(--misty-warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--misty-warning)_8%,var(--card))]">
            <ShieldCheck />
            <AlertTitle>{approval.action_summary}</AlertTitle>
            <AlertDescription>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {JSON.stringify(approval.proposed_actions, null, 2)}
              </pre>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  type="button"
                  onClick={() => onDecide(false)}
                >
                  <CircleStop />
                  Reject
                </Button>
                <Button size="sm" disabled={busy} type="button" onClick={() => onDecide(true)}>
                  <Check />
                  Approve
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RunJSON({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className={eyebrowClass}>{title}</p>
      <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
function workflowDefinitionHasNode(
  definition: Record<string, unknown> | undefined,
  kind: string,
): boolean {
  if (!definition) return false;
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  return nodes.some((value) => {
    if (!value || typeof value !== "object") return false;
    const node = value as { kind?: unknown; config?: { childGraph?: Record<string, unknown> } };
    return node.kind === kind || workflowDefinitionHasNode(node.config?.childGraph, kind);
  });
}
function workflowPreauthorizedWrites(
  definition: Record<string, unknown> | undefined,
  connections: Record<string, string>,
): Array<Record<string, string>> {
  if (!definition || !Array.isArray(definition.nodes)) return [];
  const safeWriteKinds = new Set([
    "create_document",
    "write_library_artifact",
    "post_reply",
    "update_metadata",
    "exact_tool",
  ]);
  return definition.nodes.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const node = value as { id?: unknown; kind?: unknown; config?: Record<string, unknown> };
    if (
      typeof node.id !== "string" ||
      typeof node.kind !== "string" ||
      !safeWriteKinds.has(node.kind)
    )
      return [];
    const provider = typeof node.config?.provider === "string" ? node.config.provider : "";
    const destination =
      typeof node.config?.destination === "string"
        ? node.config.destination
        : typeof node.config?.outputDirectory === "string"
          ? node.config.outputDirectory
          : typeof node.config?.filename === "string"
            ? node.config.filename
            : "";
    if (!destination) return [];
    return [
      {
        nodeId: node.id,
        provider,
        connectionId: provider ? (connections[provider] ?? "") : "",
        destination,
      },
    ];
  });
}
function runStatus(state: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (state === "completed") return "success";
  if (state === "completed_with_errors" || state === "cooldown" || state === "awaiting_approval")
    return "warning";
  if (state === "failed" || state === "rejected" || state === "canceled") return "danger";
  if (state === "running" || state === "queued") return "info";
  return "neutral";
}
const sectionClass = "p-4";
const eyebrowClass = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
