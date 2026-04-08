import type {
  AgentCenterTab,
  AgentRuntime,
  RunDetail,
} from "@/models/types/pages/Agents/AgentCenter";
export type {
  AgentCenterTab,
  AgentRuntime,
  RunDetail,
} from "@/models/types/pages/Agents/AgentCenter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Plug,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
  Workflow,
  X,
} from "lucide-react";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import { SpaceRequestError, spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  AgentCatalogEntry,
  AgentInstanceRecord,
  AvailableProviderResource,
  ProviderConnectionAvailability,
  ProviderSharedResource,
  RunAction,
  RunApproval,
  SpaceIntegration,
  SpaceRun,
  WorkflowRunStep,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceCalendarSource } from "@/models/interfaces/features/spaces/types";
import { errorText } from "@/lib/format";
import { openProviderAuthorizationLink } from "@/platform/openExternalLink";
import { providerCatalog, providerById } from "../../features/workflows/providers";
import SpaceStudioPage from "@/pages/Studio";
import type { SpaceStudioKind } from "@/models/types/pages/Studio/index";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui";
import { Checkbox } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/ui";
import { Tabs, TabsList, TabsTrigger } from "@/ui";
import { ToggleGroup, ToggleGroupItem } from "@/ui";
import { EmptyState, LoadingState } from "@/ui";
import { PrimitiveIconButton as IconButton } from "@/ui";
import { StatusBadge } from "@/ui";

export function AgentCenter({
  spaceId,
  canRun,
  canViewStudio,
}: {
  spaceId: string;
  spaceName: string;
  canRun: boolean;
  canViewStudio: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentRuntime[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [providerAvailability, setProviderAvailability] = useState<
    ProviderConnectionAvailability[]
  >([]);
  const [sharedResources, setSharedResources] = useState<ProviderSharedResource[]>([]);
  const [calendarSources, setCalendarSources] = useState<SpaceCalendarSource[]>([]);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [selectedAgentId, setSelectedAgentId] = useState(
    () => searchParams.get("agentId") ?? "all",
  );
  const [openedRunId, setOpenedRunId] = useState(() => searchParams.get("runId") ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const runReturnFocus = useRef<HTMLElement | null>(null);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const agentSegment = pathParts[pathParts.indexOf("agents") + 1] ?? "";
  const tab = normalizeAgentTab(agentSegment, canRun, canViewStudio);
  const studioKind: SpaceStudioKind =
    pathParts[pathParts.length - 1] === "workflows" ? "workflows" : "agents";
  useEffect(() => {
    if (agentSegment) return;
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/agents/${canRun ? "attention" : "studio/agents"}`,
      { replace: true },
    );
  }, [agentSegment, canRun, navigate, spaceId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [{ agents: catalog }, { integrations: connected, providers = [] }, shared, calendars] =
        await Promise.all([
          agentArchitectureApi.catalog(),
          agentArchitectureApi.integrations(spaceId),
          agentArchitectureApi.sharedProviderResources(spaceId),
          spacesApi.calendarSources(spaceId),
        ]);
      const visible = catalog.filter((item) => item.space_id === spaceId);
      const runtime = await Promise.all(
        visible.map(async (item): Promise<AgentRuntime> => {
          const [instanceResult, runsResult] = await Promise.allSettled([
            agentArchitectureApi.agentInstance(spaceId, item.agent_id),
            agentArchitectureApi.runs(spaceId, item.agent_id),
          ]);
          return {
            catalog: item,
            instance: instanceResult.status === "fulfilled" ? instanceResult.value : undefined,
            runs: runsResult.status === "fulfilled" ? runsResult.value.runs : [],
          };
        }),
      );
      const attentionRuns = runtime
        .flatMap((item) => item.runs)
        .filter((run) => run.state === "awaiting_approval" || run.state === "failed");
      const attentionDetails = await Promise.all(
        attentionRuns.map(async (run) => {
          try {
            return [run.id, await agentArchitectureApi.runDetail(run.id)] as const;
          } catch {
            return null;
          }
        }),
      );
      setAgents(runtime);
      setIntegrations(connected);
      setProviderAvailability(providers);
      setSharedResources(shared.resources);
      setCalendarSources(calendars.sources);
      setDetails(
        Object.fromEntries(attentionDetails.filter(Boolean) as Array<readonly [string, RunDetail]>),
      );
      if (
        selectedAgentId !== "all" &&
        !runtime.some((item) => item.catalog.agent_id === selectedAgentId)
      )
        setSelectedAgentId("all");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId, spaceId]);

  useEffect(() => {
    if (canRun) void load();
    else setLoading(false);
  }, [canRun, load]);
  useEffect(() => {
    const refreshAfterAuthorization = () => {
      if (canRun && document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshAfterAuthorization);
    return () => window.removeEventListener("focus", refreshAfterAuthorization);
  }, [canRun, load]);
  const scopedAgents =
    selectedAgentId === "all"
      ? agents
      : agents.filter((item) => item.catalog.agent_id === selectedAgentId);
  const allRuns = useMemo(
    () =>
      scopedAgents
        .flatMap((item) => item.runs.map((run) => ({ run, agent: item })))
        .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at)),
    [scopedAgents],
  );
  const connectionAttention = integrations.filter((item) => item.status !== "active");
  const resourceAttention = sharedResources.filter((item) => item.status === "needs_attention");
  const calendarAttention = calendarSources.filter(
    (item) => item.status === "needs_attention" || item.status === "disabled",
  );
  const updateAttention = scopedAgents.filter((item) => item.instance?.update_available);
  const approvalAttention = allRuns.filter(({ run }) => run.state === "awaiting_approval");
  const failedAttention = allRuns.filter(({ run }) => run.state === "failed");
  const attentionCount =
    approvalAttention.length +
    failedAttention.length +
    connectionAttention.length +
    resourceAttention.length +
    calendarAttention.length +
    updateAttention.length;
  const results = allRuns.filter(
    ({ run }) => run.state === "completed" || run.state === "completed_with_errors",
  );
  const active = allRuns.filter(({ run }) =>
    ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state),
  );
  const openedDetail = openedRunId ? details[openedRunId] : undefined;

  const openRun = async (runId: string, trigger?: HTMLElement) => {
    if (trigger) runReturnFocus.current = trigger;
    setOpenedRunId(runId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("runId", runId);
    setSearchParams(nextParams, { replace: true });
    if (details[runId]) return;
    setBusy(runId);
    try {
      const detail = await agentArchitectureApi.runDetail(runId);
      setDetails((current) => ({ ...current, [runId]: detail }));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    const linkedRunId = searchParams.get("runId") ?? "";
    if (!linkedRunId || details[linkedRunId] || busy === linkedRunId) return;
    void openRun(linkedRunId);
  }, [busy, details, searchParams]);
  const decide = async (runId: string, approved: boolean) => {
    setBusy(runId);
    try {
      await agentArchitectureApi.decideRun(runId, approved);
      setOpenedRunId("");
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const cancel = async (runId: string) => {
    setBusy(runId);
    try {
      await agentArchitectureApi.cancelRun(runId);
      setOpenedRunId("");
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const retry = async (runId: string) => {
    setBusy(runId);
    try {
      await agentArchitectureApi.retryRun(runId);
      setOpenedRunId("");
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };

  const selectedAgentQuery =
    selectedAgentId !== "all" ? `?agentId=${encodeURIComponent(selectedAgentId)}` : "";
  const openTab = (next: AgentCenterTab) =>
    navigate(
      next === "studio"
        ? `/spaces/${encodeURIComponent(spaceId)}/agents/studio/agents${selectedAgentQuery}`
        : `/spaces/${encodeURIComponent(spaceId)}/agents/${next}${selectedAgentQuery}`,
    );
  const tabs = tabDefinitions.filter((item) => (item.id === "studio" ? canViewStudio : canRun));

  const renderTabs = () => (
    <Tabs value={tab} onValueChange={(value) => openTab(value as AgentCenterTab)}>
      <TabsList
        className="h-9 shrink-0 border-0 bg-transparent p-0"
        aria-label="Agent Center sections"
      >
        {tabs.map((item) => (
          <TabsTrigger key={item.id} value={item.id} className="h-8 gap-1.5 px-2.5 text-xs">
            <item.icon className="size-3.5" />
            {item.label}
            {item.id === "attention" && attentionCount ? (
              <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
                {attentionCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  if (tab === "studio")
    return (
      <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
        <div
          className="flex min-h-12 items-center gap-3 overflow-x-auto border-b border-border/60 bg-card px-4"
          aria-label="Agent Center sections"
        >
          {renderTabs()}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={studioKind}
            onValueChange={(value) => {
              if (!value) return;
              const selection = value as SpaceStudioKind;
              const queryKey = selection === "agents" ? "agentId" : "workflowId";
              const selectedId = searchParams.get(queryKey);
              navigate(
                `/spaces/${encodeURIComponent(spaceId)}/agents/studio/${selection}${selectedId ? `?${queryKey}=${encodeURIComponent(selectedId)}` : ""}`,
              );
            }}
            className="ml-auto rounded-lg bg-muted p-0.5"
            aria-label="Studio type"
          >
            <ToggleGroupItem value="agents" className="h-7 gap-1.5 px-2 text-xs">
              <Bot />
              Agents
            </ToggleGroupItem>
            <ToggleGroupItem value="workflows" className="h-7 gap-1.5 px-2 text-xs">
              <Workflow />
              Workflows
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="min-h-0">
          <SpaceStudioPage spaceId={spaceId} kind={studioKind} />
        </div>
      </main>
    );

  const runningCount = agents.reduce(
    (total, item) =>
      total +
      item.runs.filter((run) =>
        ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state),
      ).length,
    0,
  );
  return (
    <main className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] overflow-hidden bg-background">
      <aside
        className="min-h-0 overflow-auto border-r border-border/60 bg-sidebar p-3"
        aria-label="Agents"
      >
        <div className="mb-2 flex min-h-9 items-center px-2">
          <strong className="truncate text-sm font-semibold text-sidebar-foreground">Agents</strong>
          <IconButton
            className="ml-auto"
            size="sm"
            label="Refresh Agent Center"
            onClick={() => void load()}
          >
            <RefreshCcw className={loading ? "animate-spin" : ""} />
          </IconButton>
        </div>
        <nav className="flex min-h-0 flex-col gap-2" aria-label="Agents">
          <div className="grid gap-1">
            <AgentRailRow
              active={selectedAgentId === "all"}
              name="All Agents"
              detail={`${agents.length} available`}
              attention={attentionCount}
              running={runningCount}
              onClick={() => {
                setSelectedAgentId("all");
                navigate(location.pathname, { replace: true });
              }}
            />
          </div>
          <div className="grid gap-1 border-t border-border/60 pt-3">
            <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
              Published agents
            </div>
            {agents.map((item) => (
              <AgentRailRow
                key={item.catalog.agent_id}
                active={selectedAgentId === item.catalog.agent_id}
                name={item.catalog.agent_name}
                detail={item.instance?.status === "running" ? "Running" : "Idle"}
                attention={attentionForAgent(item, details, integrations)}
                running={
                  item.runs.filter((run) =>
                    ["queued", "running", "cooldown", "awaiting_approval"].includes(run.state),
                  ).length
                }
                onClick={() => {
                  setSelectedAgentId(item.catalog.agent_id);
                  navigate(
                    `${location.pathname}?agentId=${encodeURIComponent(item.catalog.agent_id)}`,
                    { replace: true },
                  );
                }}
              />
            ))}
            {!loading && !agents.length ? (
              <EmptyState
                compact
                icon={<Bot />}
                title="No published Agents"
                description="Published Agents will appear here when they become available in this Space."
              />
            ) : null}
          </div>
        </nav>
      </aside>
      <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-background">
        <header className="flex min-h-12 items-center gap-3 border-b border-border/60 bg-card px-4">
          <strong className="truncate text-sm">
            {selectedAgentId === "all"
              ? "All Agents"
              : (scopedAgents[0]?.catalog.agent_name ?? "Agent")}
          </strong>
          {attentionCount ? (
            <StatusBadge status="warning" dot>
              {attentionCount} need attention
            </StatusBadge>
          ) : (
            <StatusBadge status="success" dot>
              All clear
            </StatusBadge>
          )}
          {selectedAgentId !== "all" && scopedAgents[0] ? (
            <Button
              className="ml-auto"
              size="sm"
              variant="outline"
              type="button"
              onClick={() =>
                navigate(
                  `/spaces/${encodeURIComponent(spaceId)}/chat?agentId=${encodeURIComponent(selectedAgentId)}`,
                )
              }
            >
              <LockKeyhole />
              Chat
            </Button>
          ) : null}
        </header>
        <div
          className="flex min-h-12 items-center overflow-x-auto border-b border-border/60 bg-card px-4"
          aria-label="Agent Center sections"
        >
          {renderTabs()}
        </div>
        <div className="min-h-0 overflow-auto p-5">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle />
              <AlertTitle>Agent Center couldn’t complete that request</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <IconButton
                className="absolute right-2 top-2"
                size="sm"
                label="Dismiss error"
                onClick={() => setError("")}
              >
                <X />
              </IconButton>
            </Alert>
          ) : null}
          {loading ? (
            <LoadingState
              className="h-full"
              title="Loading Agent activity"
              description="Checking runs, approvals, and connected providers…"
            />
          ) : tab === "attention" ? (
            <AttentionView
              approvals={approvalAttention}
              failed={failedAttention}
              updates={updateAttention}
              integrations={connectionAttention}
              resources={resourceAttention}
              calendars={calendarAttention}
              details={details}
              busy={busy}
              canRun={canRun}
              onOpen={openRun}
              onDecide={decide}
              onRetry={retry}
            />
          ) : tab === "results" ? (
            <RunList
              title="Proactive results"
              empty="Completed workflow results will appear here."
              items={results}
              busy={busy}
              onOpen={openRun}
            />
          ) : tab === "activity" ? (
            <RunList
              title="Live activity"
              empty="No Agents are running right now."
              items={active}
              busy={busy}
              onOpen={openRun}
            />
          ) : tab === "history" ? (
            <HistoryView
              items={allRuns}
              query={query}
              setQuery={setQuery}
              busy={busy}
              onOpen={openRun}
            />
          ) : (
            <SettingsView
              spaceId={spaceId}
              agents={scopedAgents}
              integrations={integrations}
              providers={providerAvailability}
              busy={busy}
              setBusy={setBusy}
              onReload={load}
              setError={setError}
            />
          )}
        </div>
      </section>
      {openedRunId ? (
        <AgentRunDrawer
          detail={openedDetail}
          loading={busy === openedRunId}
          canRun={canRun}
          busy={Boolean(busy)}
          onClose={() => {
            setOpenedRunId("");
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("runId");
            setSearchParams(nextParams, { replace: true });
            queueMicrotask(() => runReturnFocus.current?.focus());
          }}
          onDecide={(approved) => void decide(openedRunId, approved)}
          onCancel={() => void cancel(openedRunId)}
          onRetry={() => void retry(openedRunId)}
        />
      ) : null}
    </main>
  );
}

function AttentionView({
  approvals,
  failed,
  updates,
  integrations,
  resources,
  calendars,
  details,
  busy,
  canRun,
  onOpen,
  onDecide,
  onRetry,
}: {
  approvals: Array<{ run: SpaceRun; agent: AgentRuntime }>;
  failed: Array<{ run: SpaceRun; agent: AgentRuntime }>;
  updates: AgentRuntime[];
  integrations: SpaceIntegration[];
  resources: ProviderSharedResource[];
  calendars: SpaceCalendarSource[];
  details: Record<string, RunDetail>;
  busy: string;
  canRun: boolean;
  onOpen: (id: string, trigger: HTMLElement) => void;
  onDecide: (id: string, approved: boolean) => void;
  onRetry: (id: string) => void;
}) {
  const empty =
    !approvals.length &&
    !failed.length &&
    !updates.length &&
    !integrations.length &&
    !resources.length &&
    !calendars.length;
  return (
    <div className="mx-auto grid max-w-4xl gap-3">
      {empty ? (
        <EmptyState
          icon={<Check />}
          title="Nothing needs your attention"
          description="Approvals, failed runs, and connection issues will show up here."
        />
      ) : null}
      {approvals.map(({ run, agent }) => (
        <ApprovalCard
          key={run.id}
          run={run}
          agent={agent}
          detail={details[run.id]}
          busy={busy === run.id}
          canRun={canRun}
          onOpen={onOpen}
          onDecide={onDecide}
        />
      ))}
      {failed.map(({ run, agent }) => (
        <AttentionCard
          key={run.id}
          icon={AlertTriangle}
          tone="danger"
          title={`${agent.catalog.agent_name} run failed`}
          detail={`${run.error_message || run.error_code || "A workflow node exhausted its attempts."} · ${formatDate(run.updated_at)}`}
          action={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canRun || busy === run.id}
                onClick={() => void onRetry(run.id)}
              >
                <RefreshCcw />
                Retry
              </Button>
              <IconButton
                size="sm"
                label="Inspect failed run"
                onClick={(event) => void onOpen(run.id, event.currentTarget)}
              >
                <ChevronRight />
              </IconButton>
            </>
          }
        />
      ))}
      {updates.map((item) => (
        <AttentionCard
          key={item.catalog.agent_id}
          icon={Sparkles}
          tone="info"
          title={`${item.catalog.agent_name} has an update`}
          detail="Your pinned version will upgrade only while no run is active or approval-blocked."
        />
      ))}
      {integrations.map((item) => (
        <AttentionCard
          key={item.id}
          icon={Unplug}
          tone="danger"
          title={`Reconnect ${providerById(item.provider)?.name ?? item.provider}`}
          detail={`${item.display_name} · ${item.status.replace(/_/g, " ")}`}
        />
      ))}
      {resources.map((item) => (
        <AttentionCard
          key={item.id}
          icon={Unplug}
          tone="danger"
          title={`${providerById(item.provider)?.name ?? item.provider} source needs attention`}
          detail={`${item.display_name} · ${(item.last_error_code || item.status).replace(/_/g, " ")}`}
        />
      ))}
      {calendars.map((item) => (
        <AttentionCard
          key={item.id}
          icon={CalendarClock}
          tone="danger"
          title="Google Calendar source needs attention"
          detail={`${item.display_name} · ${(item.last_error_code || item.status).replace(/_/g, " ")}`}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  run,
  agent,
  detail,
  busy,
  canRun,
  onOpen,
  onDecide,
}: {
  run: SpaceRun;
  agent: AgentRuntime;
  detail?: RunDetail;
  busy: boolean;
  canRun: boolean;
  onOpen: (id: string, trigger: HTMLElement) => void;
  onDecide: (id: string, approved: boolean) => void;
}) {
  const approval = detail?.approvals.find((item) => item.state === "pending");
  const action = detail?.actions.find((item) => item.state === "proposed");
  const info = approvalCardInfo(approval?.proposed_actions?.[0]);
  return (
    <Card className="bg-[color-mix(in_srgb,var(--misty-warning)_6%,var(--card))] shadow-none ring-1 ring-[color-mix(in_srgb,var(--misty-warning)_24%,transparent)]">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--misty-warning)_12%,transparent)] text-[var(--misty-warning)]">
          <ShieldCheck size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {approval?.action_summary ?? action?.summary ?? "Approve external action"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {agent.catalog.agent_name} · {run.workflow_identifier}@{run.workflow_version} ·{" "}
            {info.provider || providerLabel(action?.details)}
          </p>
          {info.reason ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{info.reason}</p>
          ) : null}
          <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted p-3 text-xs">
            <dt className="text-muted-foreground">Bot</dt>
            <dd className="truncate">{info.bot || "Misty"}</dd>
            <dt className="text-muted-foreground">Destination</dt>
            <dd className="break-all">{info.destination || "Selected workflow destination"}</dd>
            <dt className="text-muted-foreground">Connection</dt>
            <dd className="break-all">{info.connection || "Space installation"}</dd>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{approval?.expires_at ? formatDate(approval.expires_at) : "Soon"}</dd>
          </dl>
          {info.content ? (
            <div className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
              {info.content}
            </div>
          ) : null}
          {info.citations.length ? (
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Approval citations">
              {info.citations.slice(0, 4).map((citation, index) => (
                <Badge variant="secondary" className="font-normal" key={`${citation}-${index}`}>
                  {citation}
                </Badge>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            {info.reversibility ||
              "The destination and permissions are checked again immediately before execution."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canRun || busy}
            onClick={() => onDecide(run.id, false)}
          >
            Reject
          </Button>
          <Button size="sm" disabled={!canRun || busy} onClick={() => onDecide(run.id, true)}>
            Approve
          </Button>
          <IconButton
            size="sm"
            label="Inspect approval"
            onClick={(event) => void onOpen(run.id, event.currentTarget)}
          >
            <ChevronRight />
          </IconButton>
        </div>
      </CardContent>
    </Card>
  );
}

function RunList({
  title,
  empty,
  items,
  busy,
  onOpen,
}: {
  title: string;
  empty: string;
  items: Array<{ run: SpaceRun; agent: AgentRuntime }>;
  busy: string;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  return (
    <div className="mx-auto grid max-w-4xl gap-1">
      <h2 className="sr-only">{title}</h2>
      {!items.length ? (
        <EmptyState
          icon={<Clock3 />}
          title={empty}
          description="This view will update automatically as your Agents work."
        />
      ) : (
        items.map(({ run, agent }) => (
          <Button
            variant="ghost"
            className="grid h-auto min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-muted/30 px-3 py-2.5 text-left shadow-none hover:bg-muted/60"
            type="button"
            key={run.id}
            onClick={(event) => void onOpen(run.id, event.currentTarget)}
          >
            <StatusBadge status={runStatus(run.state)} dot className="capitalize">
              {run.state.replace(/_/g, " ")}
            </StatusBadge>
            <span className="min-w-0">
              <strong className="block truncate text-sm">
                {agent.catalog.agent_name} · {run.capability_id || run.trigger_kind}
              </strong>
              <small className="mt-1 block truncate text-xs text-muted-foreground">
                {run.workflow_identifier}@{run.workflow_version} · {formatDate(run.created_at)}
              </small>
            </span>
            {busy === run.id ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </Button>
        ))
      )}
    </div>
  );
}

function HistoryView({
  items,
  query,
  setQuery,
  busy,
  onOpen,
}: {
  items: Array<{ run: SpaceRun; agent: AgentRuntime }>;
  query: string;
  setQuery: (value: string) => void;
  busy: string;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  const filtered = items.filter(({ run, agent }) =>
    `${agent.catalog.agent_name} ${run.state} ${run.capability_id} ${run.workflow_identifier}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="mx-auto grid max-w-4xl gap-3">
      <label className="relative ml-auto block min-w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Filter runs</span>
        <Input
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter runs"
        />
      </label>
      <RunList
        title="Run history"
        empty="No matching runs."
        items={filtered}
        busy={busy}
        onOpen={onOpen}
      />
    </div>
  );
}

function SettingsView({
  spaceId,
  agents,
  integrations,
  providers,
  busy,
  setBusy,
  onReload,
  setError,
}: {
  spaceId: string;
  agents: AgentRuntime[];
  integrations: SpaceIntegration[];
  providers: ProviderConnectionAvailability[];
  busy: string;
  setBusy: (value: string) => void;
  onReload: () => Promise<void>;
  setError: (value: string) => void;
}) {
  const [unavailableProviders, setUnavailableProviders] = useState<Set<string>>(() => new Set());
  const connect = async (providerId: string) => {
    setBusy(providerId);
    setError("");
    try {
      const result = await agentArchitectureApi.beginProviderConnection(
        spaceId,
        providerId,
        window.location.pathname + window.location.search,
      );
      await openProviderAuthorizationLink(result.authorization_url);
    } catch (reason) {
      if (reason instanceof SpaceRequestError && reason.code === "provider_not_configured") {
        setUnavailableProviders((current) => new Set(current).add(providerId));
      }
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const disconnect = async (id: string) => {
    setBusy(id);
    try {
      await agentArchitectureApi.deleteIntegration(id);
      await onReload();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const bindConnection = async (
    instance: AgentInstanceRecord,
    provider: string,
    connectionId: string,
  ) => {
    setBusy(`${instance.id}:${provider}`);
    try {
      const bindings = { ...instance.connection_bindings };
      if (connectionId) bindings[provider] = connectionId;
      else delete bindings[provider];
      await agentArchitectureApi.updateInstanceConnections(instance.id, bindings);
      await onReload();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Alert>
        <ShieldCheck />
        <AlertTitle>Private by default</AlertTitle>
        <AlertDescription>Your credentials and Agent activity remain private.</AlertDescription>
      </Alert>
      {agents.map((item) => (
        <Card key={item.catalog.agent_id}>
          <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
            <div>
              <CardTitle className="text-sm">{item.catalog.agent_name}</CardTitle>
              <CardDescription className="mt-1 text-xs">
                Pinned version {item.instance?.agent_version_id ?? "not initialized"} ·{" "}
                {item.instance?.status ?? "idle"}
              </CardDescription>
            </div>
            {item.instance?.update_available ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === item.catalog.agent_id || item.instance.status !== "idle"}
                onClick={async () => {
                  setBusy(item.catalog.agent_id);
                  try {
                    await agentArchitectureApi.updateAgentInstance(spaceId, item.catalog.agent_id);
                    await onReload();
                  } catch (reason) {
                    setError(errorText(reason));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <RefreshCcw />
                Update
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-3 px-4 pb-4">
            {item.instance?.workflows.map((workflow) => (
              <div
                className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2"
                key={workflow.workflow_version_id}
              >
                <span className="text-xs">Workflow {workflow.workflow_version_id}</span>
                <StatusBadge status={workflow.enabled ? "success" : "neutral"} dot>
                  {workflow.enabled ? "Enabled" : "Disabled"}
                </StatusBadge>
              </div>
            ))}
            {item.instance && integrations.some((connection) => connection.status === "active") ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {providerCatalog
                  .filter((provider) =>
                    integrations.some(
                      (connection) =>
                        connection.provider === provider.id && connection.status === "active",
                    ),
                  )
                  .map((provider) => (
                    <label
                      className="grid gap-1.5 text-xs font-medium text-foreground"
                      key={provider.id}
                    >
                      <span>{provider.name} account</span>
                      <Select
                        disabled={busy === `${item.instance!.id}:${provider.id}`}
                        value={item.instance!.connection_bindings[provider.id] || "unavailable"}
                        onValueChange={(value) =>
                          void bindConnection(
                            item.instance!,
                            provider.id,
                            value === "unavailable" ? "" : value,
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unavailable">Not available to this Agent</SelectItem>
                          {integrations
                            .filter(
                              (connection) =>
                                connection.provider === provider.id &&
                                connection.status === "active",
                            )
                            .map((connection) => (
                              <SelectItem key={connection.id} value={connection.id}>
                                {connection.display_name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Provider connections</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            OAuth scopes are requested incrementally and tokens never appear in workflow
            definitions.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providerCatalog.map((provider) => {
            const connection = integrations.find((item) => item.provider === provider.id);
            const unavailable =
              providers.find((item) => item.provider === provider.id)?.configured === false ||
              unavailableProviders.has(provider.id);
            return (
              <Card key={provider.id} className="shadow-none">
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-4">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                    style={{ background: provider.color }}
                  >
                    <Plug size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-sm">{provider.name}</CardTitle>
                    <CardDescription className="mt-1 line-clamp-2 text-xs leading-relaxed">
                      {provider.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {connection ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge
                          status={connection.status === "active" ? "success" : "warning"}
                          dot
                          className="min-w-0 truncate capitalize"
                        >
                          {connection.display_name} · {connection.status.replace(/_/g, " ")}
                        </StatusBadge>
                        <IconButton
                          size="sm"
                          label={`Disconnect ${provider.name}`}
                          disabled={busy === connection.id}
                          onClick={() => void disconnect(connection.id)}
                        >
                          <Unplug />
                        </IconButton>
                      </div>
                      {connection.status === "active" && provider.id !== "google" ? (
                        <IntegrationResourceManager
                          spaceId={spaceId}
                          connection={connection}
                          setError={setError}
                        />
                      ) : provider.id === "google" && connection.status === "active" ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Publish calendars from Tasks &amp; Calendar.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={busy === provider.id || unavailable}
                        onClick={() => void connect(provider.id)}
                      >
                        {busy === provider.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : unavailable ? (
                          <Unplug />
                        ) : (
                          <ExternalLink />
                        )}{" "}
                        {unavailable ? "Unavailable" : "Connect"}
                      </Button>
                      {unavailable ? (
                        <p className="mt-2 text-xs text-[var(--misty-warning)]">
                          Sign-in has not been configured on this Misty server.
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function IntegrationResourceManager({
  spaceId,
  connection,
  setError,
}: {
  spaceId: string;
  connection: SpaceIntegration;
  setError: (value: string) => void;
}) {
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
      setPublished(
        shared.resources.filter(
          (item) => item.integration_id === connection.id && item.status !== "disabled",
        ),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [connection.id, setError, spaceId]);

  useEffect(() => {
    if (open) void loadResources();
  }, [loadResources, open]);
  const toggle = async (resource: AvailableProviderResource) => {
    const current = published.find(
      (item) =>
        item.external_resource_id === resource.external_resource_id &&
        item.resource_type === resource.resource_type,
    );
    const key = `${resource.resource_type}:${resource.external_resource_id}`;
    setBusyResource(key);
    try {
      if (current) await agentArchitectureApi.disableProviderResource(spaceId, current.id);
      else await agentArchitectureApi.publishProviderResource(spaceId, connection.id, resource);
      await loadResources();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyResource("");
    }
  };
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FileText />
        {open ? "Hide shared sources" : "Choose shared sources"}
      </Button>
      {open ? (
        <div className="mt-2 grid max-h-48 gap-1 overflow-auto">
          {loading && !available.length ? (
            <LoadingState compact title="Loading sources" />
          ) : (
            available.map((resource) => {
              const selected = published.some(
                (item) =>
                  item.external_resource_id === resource.external_resource_id &&
                  item.resource_type === resource.resource_type,
              );
              const key = `${resource.resource_type}:${resource.external_resource_id}`;
              return (
                <label
                  className="flex items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-2 text-xs"
                  key={key}
                >
                  <Checkbox
                    checked={selected}
                    disabled={busyResource === key}
                    onCheckedChange={() => void toggle(resource)}
                  />
                  <span className="min-w-0 flex-1 truncate">{resource.display_name}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {resource.resource_type.replace("_", " ")}
                  </Badge>
                </label>
              );
            })
          )}
          {!loading && !available.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              No accessible sources were returned by this provider.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentRunDrawer({
  detail,
  loading,
  canRun,
  busy,
  onClose,
  onDecide,
  onCancel,
  onRetry,
}: {
  detail?: RunDetail;
  loading: boolean;
  canRun: boolean;
  busy: boolean;
  onClose: () => void;
  onDecide: (approved: boolean) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const approval = detail?.approvals.find((item) => item.state === "pending");
  const title = detail?.run.capability_id || detail?.run.trigger_kind || "Agent run";
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <SheetHeader className="flex-row items-start justify-between space-y-0 border-b border-border/60 px-5 py-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="truncate text-sm">{title}</SheetTitle>
            <SheetDescription className="mt-1 text-xs">
              Execution details, actions, and output
            </SheetDescription>
          </div>
          <IconButton size="sm" label="Close run details" onClick={onClose} disabled={busy}>
            <X />
          </IconButton>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading || !detail ? (
            <LoadingState className="min-h-64" title="Loading run details" />
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["State", detail.run.state],
                  ["Attempt", String(detail.run.attempt ?? 1)],
                  ["Progress", `${Math.round(detail.run.progress || 0)}%`],
                ].map(([label, value]) => (
                  <div className="rounded-lg bg-muted/50 p-3" key={label}>
                    <span className="block text-xs text-muted-foreground">{label}</span>
                    <strong className="mt-1 block text-xs capitalize">
                      {value.replace(/_/g, " ")}
                    </strong>
                  </div>
                ))}
              </div>
              <section className="mt-5">
                <strong className="text-sm">Node progress</strong>
                <div className="mt-3 grid gap-1">
                  {detail.steps.map((step) => (
                    <Card className="bg-muted/40 shadow-none ring-0" key={step.ID}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs">{step.NodeID}</strong>
                          <StatusBadge
                            className="ml-auto capitalize"
                            status={runStatus(step.State)}
                          >
                            {step.State.replace(/_/g, " ")} · attempt {step.Attempt}
                          </StatusBadge>
                        </div>
                        {step.ErrorMessage ? (
                          <p className="mt-2 text-xs text-destructive">
                            {step.ErrorCode}: {step.ErrorMessage}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
              <section className="mt-5">
                <strong className="text-sm">Action timeline</strong>
                <div className="mt-3 grid gap-1">
                  {detail.actions.map((action) => (
                    <Card className="bg-muted/40 shadow-none ring-0" key={action.id}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2">
                          {action.destructive ? (
                            <AlertTriangle className="text-[var(--misty-warning)]" size={13} />
                          ) : (
                            <ShieldCheck className="text-[var(--misty-success)]" size={13} />
                          )}
                          <strong className="text-xs">{action.summary}</strong>
                          <StatusBadge
                            className="ml-auto capitalize"
                            status={runStatus(action.state)}
                          >
                            {action.state}
                          </StatusBadge>
                        </div>
                        {Object.keys(action.details ?? {}).length ? (
                          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                            {JSON.stringify(action.details, null, 2)}
                          </pre>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
              <section className="mt-5">
                <strong className="text-sm">Output</strong>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">
                  {JSON.stringify(detail.run.outputs, null, 2)}
                </pre>
              </section>
              {approval ? (
                <Alert className="mt-5 border-[color-mix(in_srgb,var(--misty-warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--misty-warning)_6%,var(--card))]">
                  <ShieldCheck />
                  <AlertTitle>{approval.action_summary}</AlertTitle>
                  <AlertDescription>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                      {JSON.stringify(approval.proposed_actions, null, 2)}
                    </pre>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canRun || busy}
                        onClick={() => onDecide(false)}
                      >
                        Reject
                      </Button>
                      <Button size="sm" disabled={!canRun || busy} onClick={() => onDecide(true)}>
                        Approve
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}
              <footer className="mt-5 flex justify-end gap-2">
                {["queued", "running", "cooldown"].includes(detail.run.state) ? (
                  <Button size="sm" variant="outline" disabled={!canRun || busy} onClick={onCancel}>
                    <CircleStop />
                    Cancel
                  </Button>
                ) : null}
                {detail.run.state === "failed" ? (
                  <Button size="sm" variant="outline" disabled={!canRun || busy} onClick={onRetry}>
                    <RefreshCcw />
                    Retry
                  </Button>
                ) : null}
              </footer>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AgentRailRow({
  active,
  name,
  detail,
  attention,
  running,
  onClick,
}: {
  active: boolean;
  name: string;
  detail: string;
  attention: number;
  running: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-current={active ? "page" : undefined}
      className={`h-auto min-h-14 w-full justify-start gap-2.5 px-2.5 py-2 text-left ${active ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground" : ""}`}
      onClick={onClick}
    >
      <Bot className="size-4 shrink-0" />
      <span className="block min-w-0 flex-1">
        <strong className="block truncate text-xs text-foreground">{name}</strong>
        <small className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
          {detail}
        </small>
      </span>
      <span className="flex shrink-0 gap-1">
        {attention ? (
          <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
            {attention}
          </Badge>
        ) : null}
        {running ? (
          <StatusBadge status="info" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
            {running}
          </StatusBadge>
        ) : null}
      </span>
    </Button>
  );
}
function AttentionCard({
  icon: Icon,
  tone,
  title,
  detail,
  action,
}: {
  icon: typeof AlertTriangle;
  tone: "danger" | "info";
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="bg-muted/30 shadow-none ring-0">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-[color-mix(in_srgb,var(--misty-info)_12%,transparent)] text-[var(--misty-info)]"}`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{title}</strong>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        {action ? <div className="flex gap-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

const tabDefinitions: Array<{ id: AgentCenterTab; label: string; icon: typeof Inbox }> = [
  { id: "attention", label: "Needs attention", icon: ShieldCheck },
  { id: "results", label: "Results", icon: Inbox },
  { id: "activity", label: "Activity", icon: CalendarClock },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "studio", label: "Studio", icon: Sparkles },
];
function normalizeAgentTab(value: string, canRun: boolean, canViewStudio: boolean): AgentCenterTab {
  if (value === "studio") return canViewStudio ? "studio" : "attention";
  if (canRun && ["attention", "results", "activity", "history", "settings"].includes(value))
    return value as AgentCenterTab;
  return canRun ? "attention" : "studio";
}
function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
function runStatus(state: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (state === "completed") return "success";
  if (state === "completed_with_errors" || state === "cooldown" || state === "awaiting_approval")
    return "warning";
  if (state === "failed" || state === "rejected") return "danger";
  if (state === "running" || state === "queued") return "info";
  return "neutral";
}
function providerLabel(details: Record<string, unknown> | undefined) {
  const provider = typeof details?.provider === "string" ? details.provider : "external provider";
  return providerById(provider)?.name ?? provider;
}
function approvalCardInfo(action: Record<string, unknown> | undefined) {
  const envelope = action ?? {};
  const input =
    envelope.input && typeof envelope.input === "object"
      ? (envelope.input as Record<string, unknown>)
      : {};
  const botValue = envelope.bot_identity ?? input.bot_identity;
  const bot = botValue && typeof botValue === "object" ? (botValue as Record<string, unknown>) : {};
  const provider =
    typeof envelope.provider === "string"
      ? envelope.provider
      : typeof input.provider === "string"
        ? input.provider
        : "";
  const rawCitations = Array.isArray(envelope.citations)
    ? envelope.citations
    : Array.isArray(input.citations)
      ? input.citations
      : [];
  return {
    provider: provider ? (providerById(provider)?.name ?? provider) : "",
    bot: typeof bot.name === "string" ? bot.name : "",
    destination:
      typeof envelope.destination === "string"
        ? envelope.destination
        : typeof input.destination === "string"
          ? input.destination
          : "",
    connection:
      typeof envelope.connection_id === "string"
        ? envelope.connection_id
        : typeof input.connection_id === "string"
          ? input.connection_id
          : "",
    content:
      typeof envelope.content_preview === "string"
        ? envelope.content_preview
        : typeof input.content_preview === "string"
          ? input.content_preview
          : "",
    reason:
      typeof envelope.reason === "string"
        ? envelope.reason
        : typeof input.reason === "string"
          ? input.reason
          : "",
    citations: rawCitations.map(formatApprovalCitation).filter(Boolean),
    reversibility:
      typeof envelope.reversibility === "string"
        ? envelope.reversibility
        : typeof input.reversibility === "string"
          ? input.reversibility
          : "",
  };
}
function formatApprovalCitation(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const citation = value as Record<string, unknown>;
  for (const key of ["locator", "displayName", "display_name", "resourceId", "resource_id"])
    if (typeof citation[key] === "string" && citation[key]) return citation[key] as string;
  return "Referenced source";
}
function attentionForAgent(
  item: AgentRuntime,
  details: Record<string, RunDetail>,
  integrations: SpaceIntegration[],
) {
  const runAttention = item.runs.filter(
    (run) =>
      run.state === "failed" ||
      run.state === "awaiting_approval" ||
      details[run.id]?.approvals.some((approval) => approval.state === "pending"),
  ).length;
  const providers = new Set(item.catalog.workflow?.metadata?.requiredIntegrations ?? []);
  const connections = integrations.filter(
    (integration) => providers.has(integration.provider) && integration.status !== "active",
  ).length;
  return runAttention + connections + (item.instance?.update_available ? 1 : 0);
}
