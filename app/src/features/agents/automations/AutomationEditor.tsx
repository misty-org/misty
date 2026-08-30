import { Button, Input, cn } from "@/shared/ui";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  GitBranch,
  History,
  LoaderCircle,
  Play,
  Plus,
  Repeat2,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { automationsApi } from "./api";
import { AutomationIntegrationIcon } from "./AutomationIntegrationIcon";
import {
  normalizeAutomationRuns,
  normalizeAutomationStructure,
  normalizeCatalogResults,
  type AutomationCatalogResult,
  type AutomationRun,
  type AutomationStep,
  type AutomationStructure,
} from "./normalizeAutomationStructure";
import type { AutomationFlow } from "./normalizeFlows";

type AutomationNodeData = { step: AutomationStep; selected: boolean };
type AutomationCanvasNode = Node<AutomationNodeData, "automation">;

const starterCatalog = [
  { label: "Gmail", query: "send an email with Gmail", value: "gmail" },
  { label: "Slack", query: "send a Slack message", value: "slack" },
  { label: "Google Sheets", query: "add a row to Google Sheets", value: "google-sheets" },
  { label: "Notion", query: "create a Notion page", value: "notion" },
  { label: "GitHub", query: "create a GitHub issue", value: "github" },
  { label: "Linear", query: "create a Linear issue", value: "linear" },
  { label: "Discord", query: "send a Discord message", value: "discord" },
  { label: "Airtable", query: "create an Airtable record", value: "airtable" },
];

export function AutomationEditor(props: {
  flow: AutomationFlow;
  onBack: () => void;
  onFlowChanged: (flowId: string, changes: Partial<AutomationFlow>) => void;
}) {
  return (
    <ReactFlowProvider>
      <AutomationEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function AutomationEditorInner(props: Parameters<typeof AutomationEditor>[0]) {
  const [structure, setStructure] = useState<AutomationStructure | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedStep, setSelectedStep] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<AutomationCatalogResult[]>([]);
  const [name, setName] = useState(props.flow.name);
  const [configText, setConfigText] = useState("{}");
  const [bottomTab, setBottomTab] = useState<"inputs" | "outputs" | "runs" | "errors">("inputs");

  const loadStructure = useCallback(async () => {
    setLoading(true);
    try {
      const [flowResult, runResult] = await Promise.all([
        automationsApi.callTool("ap_flow_structure", { flowId: props.flow.id }),
        automationsApi.callTool("ap_list_runs", { flowId: props.flow.id, limit: 20 }),
      ]);
      setStructure(normalizeAutomationStructure(flowResult.structured_content));
      setRuns(normalizeAutomationRuns(runResult.structured_content));
    } catch (error) {
      setMessage(errorMessage(error, "Misty could not load this automation."));
    } finally {
      setLoading(false);
    }
  }, [props.flow.id]);

  useEffect(() => void loadStructure(), [loadStructure]);
  useEffect(() => setName(props.flow.name), [props.flow.name]);

  const selected = structure?.steps.find((step) => step.name === selectedStep);
  const graph = useMemo(
    () => buildGraph(structure?.steps ?? [], selectedStep),
    [selectedStep, structure?.steps],
  );
  const needsTrigger = structure?.steps[0]?.type === "EMPTY";

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(errorMessage(error, "The automation service could not complete that action."));
    } finally {
      setBusy("");
    }
  };

  const rename = () =>
    runAction("rename", async () => {
      const next = name.trim();
      if (!next || next === props.flow.name) return;
      await automationsApi.callTool("ap_rename_flow", { flowId: props.flow.id, displayName: next });
      props.onFlowChanged(props.flow.id, { name: next });
      setMessage("Name saved");
    });

  const testFlow = () =>
    runAction("test", async () => {
      const result = await automationsApi.callTool("ap_test_flow", {
        flowId: props.flow.id,
        displayName: `Test ${name}`,
      });
      setMessage(firstText(result.text) || "Test run started");
      setBottomTab("runs");
      await loadStructure();
    });

  const publish = () =>
    runAction("publish", async () => {
      const validation = await automationsApi.callTool("ap_validate_flow", {
        flowId: props.flow.id,
      });
      const valid =
        isRecord(validation.structured_content) && validation.structured_content.valid === true;
      if (!valid) {
        setMessage(
          firstText(validation.text) ||
            "This automation needs attention before it can be published.",
        );
        setBottomTab("errors");
        return;
      }
      const result = await automationsApi.callTool("ap_lock_and_publish", {
        flowId: props.flow.id,
      });
      props.onFlowChanged(props.flow.id, { status: "enabled", published: true });
      setMessage(firstText(result.text) || "Automation published");
    });

  const searchCatalog = async (searchQuery = query) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return setCatalogResults([]);
    await runAction("search", async () => {
      const result = await automationsApi.callTool(
        needsTrigger ? "ap_search_triggers" : "ap_search_actions",
        { query: trimmed, limit: 8 },
      );
      setCatalogResults(
        normalizeCatalogResults(result.structured_content, needsTrigger ? "trigger" : "action"),
      );
    });
  };

  const addCatalogItem = (item: AutomationCatalogResult) =>
    runAction("add", async () => {
      if (needsTrigger) {
        await automationsApi.callTool("ap_update_trigger", {
          flowId: props.flow.id,
          pieceName: item.pieceName,
          triggerName: item.componentName,
          displayName: item.displayName,
        });
      } else {
        const parentStepName = selectedStep || lastStepName(structure) || "trigger";
        await automationsApi.callTool("ap_add_step", {
          flowId: props.flow.id,
          parentStepName,
          stepLocationRelativeToParent: "AFTER",
          stepType: "PIECE",
          displayName: item.displayName,
          pieceName: item.pieceName,
          actionName: item.componentName,
        });
      }
      setCatalogResults([]);
      setQuery("");
      await loadStructure();
    });

  const addUtility = (stepType: "CODE" | "LOOP_ON_ITEMS" | "ROUTER", displayName: string) =>
    runAction("add", async () => {
      const parentStepName = selectedStep || lastStepName(structure) || "trigger";
      await automationsApi.callTool("ap_add_step", {
        flowId: props.flow.id,
        parentStepName,
        stepLocationRelativeToParent: "AFTER",
        stepType,
        displayName,
      });
      await loadStructure();
    });

  const saveSelected = () =>
    runAction("save", async () => {
      if (!selected) return;
      let input: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(configText);
        if (!isRecord(parsed)) throw new Error("Configuration must be a JSON object.");
        input = parsed;
      } catch (error) {
        setMessage(errorMessage(error, "Configuration must be valid JSON."));
        return;
      }
      await automationsApi.callTool("ap_update_step", {
        flowId: props.flow.id,
        stepName: selected.name,
        input,
      });
      setMessage("Step settings saved");
      await loadStructure();
    });

  const deleteSelected = () =>
    runAction("delete", async () => {
      if (!selected || selected.relationship === "trigger") return;
      await automationsApi.callTool("ap_delete_step", {
        flowId: props.flow.id,
        stepName: selected.name,
      });
      setSelectedStep("");
      await loadStructure();
    });

  return (
    <main
      className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream"
      data-misty-automation-editor
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-charcoal-border px-4">
        <button
          className="flex size-8 items-center justify-center text-cream-muted hover:text-cream"
          onClick={props.onBack}
          aria-label="Back to automations"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="h-8 max-w-[360px] border-transparent bg-transparent px-2 text-sm font-semibold shadow-none hover:border-charcoal-border focus:border-charcoal-border"
          aria-label="Automation name"
        />
        <span className="rounded-full border border-charcoal-border px-2 py-1 text-[10px] text-cream-muted">
          {props.flow.published ? "Published" : "Draft"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setBottomTab("runs")}>
            <History className="size-4" /> Versions
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => void testFlow()}
          >
            {busy === "test" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}{" "}
            Test run
          </Button>
          <Button size="sm" disabled={Boolean(busy)} onClick={() => void publish()}>
            {busy === "publish" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}{" "}
            Publish
          </Button>
        </div>
      </header>

      {message ? (
        <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-card/45 px-5 text-[11px] text-cream-muted">
          <CircleAlert className="size-3.5" /> <span className="truncate">{message}</span>
          <button
            className="ml-auto hover:text-cream"
            onClick={() => setMessage("")}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 bg-charcoal-card/20">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-cream-muted">
              <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading workflow
            </div>
          ) : (
            <ReactFlow<AutomationCanvasNode, Edge>
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={{ automation: AutomationNode }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.45}
              maxZoom={1.25}
              onNodeClick={(_, node) => setSelectedStep(node.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1}
                color="var(--color-charcoal-border)"
              />
            </ReactFlow>
          )}
          {!drawerOpen ? (
            <Button
              className="absolute right-5 top-5"
              size="sm"
              onClick={() => setDrawerOpen(true)}
            >
              <Plus className="size-4" /> Add a step
            </Button>
          ) : null}
        </section>

        {drawerOpen ? (
          <aside className="flex w-[318px] shrink-0 flex-col border-l border-charcoal-border bg-charcoal-card">
            <div className="flex h-12 items-center border-b border-charcoal-border px-4">
              <h3 className="m-0 text-sm font-semibold text-cream-bright">
                {selected ? "Step settings" : needsTrigger ? "Choose a trigger" : "Add a step"}
              </h3>
              <button
                className="ml-auto text-cream-muted hover:text-cream"
                onClick={() => {
                  setSelectedStep("");
                  setDrawerOpen(false);
                }}
                aria-label="Close panel"
              >
                <X className="size-4" />
              </button>
            </div>
            {selected ? (
              <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex items-center gap-3 border-b border-charcoal-border pb-4">
                  <AutomationIntegrationIcon
                    value={`${selected.type} ${selected.displayName}`}
                    framed
                  />
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium text-cream-bright">
                      {selected.displayName}
                    </p>
                    <p className="m-0 mt-0.5 text-[10px] text-cream-muted">
                      {selected.configStatus || selected.type}
                    </p>
                  </div>
                </div>
                <label className="mt-5 block text-[11px] font-medium text-cream">Inputs</label>
                <p className="mb-2 mt-1 text-[10px] leading-4 text-cream-muted">
                  Use JSON for fields and output references. Connection fields are resolved securely
                  by Misty.
                </p>
                <textarea
                  className="h-44 w-full resize-y rounded-lg border border-charcoal-border bg-charcoal-bg p-3 font-mono text-[11px] leading-5 text-cream outline-none focus:border-charcoal-active"
                  value={configText}
                  onChange={(event) => setConfigText(event.target.value)}
                  spellCheck={false}
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" disabled={Boolean(busy)} onClick={() => void saveSelected()}>
                    {busy === "save" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}{" "}
                    Save settings
                  </Button>
                  {selected.relationship !== "trigger" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-[#d68b80]"
                      onClick={() => void deleteSelected()}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <StepCatalog
                needsTrigger={Boolean(needsTrigger)}
                query={query}
                onQueryChange={setQuery}
                onSearch={() => void searchCatalog()}
                results={catalogResults}
                loading={busy === "search" || busy === "add"}
                onPick={(item) => void addCatalogItem(item)}
                onStarter={(item) => {
                  setQuery(item.query);
                  void searchCatalog(item.query);
                }}
                onUtility={(type, label) => void addUtility(type, label)}
              />
            )}
          </aside>
        ) : null}
      </div>

      <BottomPanel tab={bottomTab} onTab={setBottomTab} runs={runs} structure={structure} />
    </main>
  );
}

function AutomationNode({ data }: NodeProps<AutomationCanvasNode>) {
  const step = data.step;
  return (
    <div
      className={cn(
        "w-[300px] border bg-charcoal-card px-4 py-3 text-left shadow-[0_10px_30px_rgba(0,0,0,.18)]",
        data.selected ? "border-charcoal-active" : "border-charcoal-border",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border-charcoal-border !bg-charcoal-card"
      />
      <div className="flex items-center gap-3">
        <AutomationIntegrationIcon value={`${step.type} ${step.displayName}`} framed />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13px] font-medium text-cream-bright">
            {step.displayName}
          </p>
          <p className="m-0 mt-0.5 truncate text-[10px] text-cream-muted">
            {step.relationship === "trigger"
              ? "Trigger"
              : step.valid
                ? "Configured"
                : "Needs setup"}
          </p>
        </div>
        {step.valid ? (
          <Check className="size-4 text-status-green" />
        ) : (
          <ChevronRight className="size-4 text-cream-muted" />
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border-charcoal-border !bg-charcoal-card"
      />
    </div>
  );
}

function StepCatalog(props: {
  needsTrigger: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  results: AutomationCatalogResult[];
  loading: boolean;
  onPick: (item: AutomationCatalogResult) => void;
  onStarter: (item: (typeof starterCatalog)[number]) => void;
  onUtility: (type: "CODE" | "LOOP_ON_ITEMS" | "ROUTER", label: string) => void;
}) {
  return (
    <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-cream-muted" />
        <Input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && props.onSearch()}
          placeholder={props.needsTrigger ? "Search triggers" : "Search integrations and actions"}
          className="pl-9 pr-9"
        />
        {props.loading ? (
          <LoaderCircle className="absolute right-3 top-2.5 size-4 animate-spin text-cream-muted" />
        ) : null}
      </div>
      {props.results.length ? (
        <div className="mt-4">
          <p className="px-2 text-[10px] font-medium text-cream-muted">Results</p>
          <div className="mt-1 divide-y divide-charcoal-border">
            {props.results.map((item) => (
              <button
                key={`${item.pieceName}:${item.componentName}`}
                className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-charcoal-hover"
                onClick={() => props.onPick(item)}
              >
                <AutomationIntegrationIcon value={item.pieceName} framed />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-cream-bright">
                    {item.displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-cream-muted">
                    {pieceLabel(item.pieceName)}
                    {item.connected ? " · Connected" : ""}
                  </span>
                </span>
                <Plus className="size-3.5 text-cream-muted" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="mb-1 mt-5 px-2 text-[10px] font-medium text-cream-muted">
            {props.needsTrigger ? "Popular triggers" : "Popular integrations"}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {starterCatalog.map((item) => (
              <button
                key={item.value}
                className="flex items-center gap-2.5 rounded-lg border border-charcoal-border bg-charcoal-bg/35 px-3 py-2.5 text-left text-xs text-cream hover:bg-charcoal-hover"
                onClick={() => props.onStarter(item)}
              >
                <AutomationIntegrationIcon value={item.value} />{" "}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
          {!props.needsTrigger ? (
            <>
              <p className="mb-1 mt-5 px-2 text-[10px] font-medium text-cream-muted">
                Flow controls
              </p>
              <div className="divide-y divide-charcoal-border border-y border-charcoal-border">
                <UtilityButton
                  icon={Code2}
                  label="Run code"
                  onClick={() => props.onUtility("CODE", "Run code")}
                />
                <UtilityButton
                  icon={Repeat2}
                  label="Loop over items"
                  onClick={() => props.onUtility("LOOP_ON_ITEMS", "Loop over items")}
                />
                <UtilityButton
                  icon={GitBranch}
                  label="Branch on a condition"
                  onClick={() => props.onUtility("ROUTER", "Branch")}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function UtilityButton(props: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      className="flex w-full items-center gap-3 px-2 py-2.5 text-left text-xs text-cream hover:bg-charcoal-hover"
      onClick={props.onClick}
    >
      <Icon className="size-4 text-cream-muted" />
      {props.label}
      <Plus className="ml-auto size-3.5 text-cream-muted" />
    </button>
  );
}

function BottomPanel(props: {
  tab: "inputs" | "outputs" | "runs" | "errors";
  onTab: (tab: "inputs" | "outputs" | "runs" | "errors") => void;
  runs: AutomationRun[];
  structure: AutomationStructure | null;
}) {
  const errors = props.structure?.steps.filter((step) => !step.valid) ?? [];
  return (
    <section className="h-[132px] shrink-0 border-t border-charcoal-border bg-charcoal-card">
      <div className="flex h-9 items-center gap-5 border-b border-charcoal-border px-5">
        {(["inputs", "outputs", "runs", "errors"] as const).map((tab) => (
          <button
            key={tab}
            className={cn(
              "h-full border-b text-[11px] capitalize",
              props.tab === tab
                ? "border-cream text-cream"
                : "border-transparent text-cream-muted hover:text-cream",
            )}
            onClick={() => props.onTab(tab)}
          >
            {tab === "runs" ? "Run history" : tab}
            {tab === "errors" && errors.length ? ` ${errors.length}` : ""}
          </button>
        ))}
      </div>
      <div className="misty-transient-scrollbar h-[92px] overflow-auto px-5 py-3 text-[11px] leading-5 text-cream-muted">
        {props.tab === "runs"
          ? props.runs.length
            ? props.runs.map((run) => (
                <div
                  key={run.id}
                  className="grid grid-cols-[110px_1fr_90px] gap-4 border-b border-charcoal-border py-1"
                >
                  <span
                    className={
                      run.status === "SUCCEEDED"
                        ? "text-status-green"
                        : run.status === "FAILED"
                          ? "text-[#d68b80]"
                          : "text-cream"
                    }
                  >
                    {sentenceCase(run.status)}
                  </span>
                  <span>{formatDate(run.created)}</span>
                  <span>{run.duration || "—"}</span>
                </div>
              ))
            : "No runs yet."
          : props.tab === "errors"
            ? errors.length
              ? errors.map((step) => (
                  <p key={step.name} className="m-0">
                    {step.displayName}: {step.configStatus || "Needs setup"}
                  </p>
                ))
              : "No configuration errors."
            : props.tab === "outputs"
              ? "Run a step or the full automation to inspect output data here."
              : "Select a step to edit its inputs. You can reference output from earlier steps."}
      </div>
    </section>
  );
}

function buildGraph(steps: AutomationStep[], selectedStep: string) {
  const depthByName = new Map<string, number>();
  const branchOffset = new Map<string, number>();
  const nodes: AutomationCanvasNode[] = steps.map((step, index) => {
    const parentDepth = step.parentName ? (depthByName.get(step.parentName) ?? index - 1) : -1;
    const depth = step.relationship === "trigger" ? 0 : parentDepth + 1;
    depthByName.set(step.name, depth);
    const offset =
      step.relationship === "branch"
        ? ((step.branchIndex ?? 0) - 0.5) * 360
        : (branchOffset.get(step.parentName ?? "") ?? 0);
    branchOffset.set(step.name, offset);
    return {
      id: step.name,
      type: "automation",
      position: { x: offset, y: depth * 126 },
      data: { step, selected: selectedStep === step.name },
    };
  });
  const edges: Edge[] = steps.flatMap((step) =>
    step.parentName
      ? [
          {
            id: `${step.parentName}:${step.name}`,
            source: step.parentName,
            target: step.name,
            type: "smoothstep",
            style: { stroke: "var(--color-charcoal-border)", strokeWidth: 1.5 },
          },
        ]
      : [],
  );
  return { nodes, edges };
}

function pieceLabel(value: string) {
  return value
    .replace(/^@activepieces\/piece-/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function sentenceCase(value: string) {
  return value.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
function firstText(value?: string[]) {
  let result = value?.find(Boolean) ?? "";
  for (const prefix of ["✅ ", "⚠️ ", "❌ ", "🔍 "]) {
    if (result.startsWith(prefix)) result = result.slice(prefix.length);
  }
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function lastStepName(structure: AutomationStructure | null) {
  return structure?.steps[structure.steps.length - 1]?.name ?? "";
}
