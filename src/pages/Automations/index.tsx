import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  Copy,
  FileInput,
  FileOutput,
  Filter,
  FolderOpen,
  Globe2,
  GripVertical,
  HardDrive,
  ListTree,
  MessageSquare,
  Move,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  automationsDeleteWorkflow,
  automationsResolveApproval,
  automationsRun,
  automationsSaveWorkflow,
  automationsSnapshot,
} from "../../api/misty";
import type {
  AutomationApproval,
  AutomationNode,
  AutomationNodeKind,
  AutomationSnapshot,
  AutomationWorkflow,
} from "../../api/types";
import { useExplorerStore } from "../../stores/useExplorerStore";
import "./styles.css";

type NodeDefinition = {
  kind: AutomationNodeKind;
  label: string;
  group: "Triggers" | "Files" | "AI" | "Integrations" | "Actions";
  icon: LucideIcon;
  color: string;
  config: Record<string, unknown>;
};

type AutomationNodeData = {
  label: string;
  kind: AutomationNodeKind;
  color: string;
  icon: LucideIcon;
};

type CanvasNode = FlowNode<AutomationNodeData, "automation">;

const nodeDefinitions: NodeDefinition[] = [
  { kind: "manual_trigger", label: "Manual trigger", group: "Triggers", icon: CirclePlay, color: "#45b97c", config: {} },
  { kind: "schedule_trigger", label: "Schedule", group: "Triggers", icon: Clock3, color: "#45b97c", config: {} },
  { kind: "webhook_trigger", label: "Webhook payload", group: "Triggers", icon: Webhook, color: "#45b97c", config: {} },
  { kind: "select_path", label: "Files / folders", group: "Files", icon: FolderOpen, color: "#4ba3d9", config: { paths: [] } },
  { kind: "list_folder", label: "List folder", group: "Files", icon: ListTree, color: "#4ba3d9", config: { path: "{{value}}" } },
  { kind: "filter", label: "Filter items", group: "Files", icon: Filter, color: "#4ba3d9", config: { contains: "" } },
  { kind: "read_text", label: "Read text", group: "Files", icon: FileInput, color: "#4ba3d9", config: { path: "{{value}}" } },
  { kind: "read_metadata", label: "Read metadata", group: "Files", icon: HardDrive, color: "#4ba3d9", config: { path: "{{value}}" } },
  { kind: "structured_prompt", label: "Structured prompt", group: "AI", icon: Sparkles, color: "#d48b45", config: { prompt: "Use this input and return a concise result:\n\n{{input}}", cwd: "" } },
  { kind: "http_request", label: "HTTP request", group: "Integrations", icon: Globe2, color: "#c96f77", config: { method: "GET", url: "", body: "" } },
  { kind: "write_text", label: "Write text file", group: "Actions", icon: FileOutput, color: "#b98bd4", config: { path: "", text: "{{input}}" } },
  { kind: "copy_path", label: "Copy", group: "Actions", icon: Copy, color: "#b98bd4", config: { source: "{{value}}", destination: "" } },
  { kind: "move_path", label: "Move", group: "Actions", icon: Move, color: "#b98bd4", config: { source: "{{value}}", destination: "" } },
  { kind: "rename_path", label: "Rename", group: "Actions", icon: FileOutput, color: "#b98bd4", config: { source: "{{value}}", destination: "" } },
  { kind: "notify", label: "Notification", group: "Actions", icon: MessageSquare, color: "#b98bd4", config: { message: "Automation completed" } },
];

const definitionByKind = new Map(nodeDefinitions.map((item) => [item.kind, item]));
const nodeTypes = { automation: AutomationCanvasNode };

export default function AutomationsPage() {
  return (
    <ReactFlowProvider>
      <AutomationPlayground />
    </ReactFlowProvider>
  );
}

function AutomationPlayground() {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>({ version: 1, webhookUrl: "http://127.0.0.1:17832", workflows: [], runs: [], approvals: [] });
  const [workflow, setWorkflow] = useState<AutomationWorkflow>(() => createWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const { screenToFlowPosition } = useReactFlow<CanvasNode, FlowEdge>();
  const pushNotification = useExplorerStore((state) => state.pushNotification);

  const loadSnapshot = useCallback(async () => {
    try {
      const next = await automationsSnapshot();
      setSnapshot(next);
      setWorkflow((current) => next.workflows.find((item) => item.id === current.id) ?? next.workflows[0] ?? current);
    } catch (error) {
      pushNotification(errorMessage(error), "error", 5200);
    } finally {
      setLoading(false);
    }
  }, [pushNotification]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const item of snapshot.workflows) {
        if (!item.enabled || !item.intervalMinutes) continue;
        const last = item.lastScheduledAt ? Date.parse(item.lastScheduledAt) : 0;
        if (now - last < item.intervalMinutes * 60_000) continue;
        const scheduled = { ...item, lastScheduledAt: new Date().toISOString() };
        void automationsSaveWorkflow(scheduled)
          .then(() => automationsRun({ workflowId: item.id, trigger: "schedule", input: {} }))
          .then(setSnapshot)
          .catch((error) => pushNotification(`Scheduled automation failed: ${errorMessage(error)}`, "error", 5200));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [pushNotification, snapshot.workflows]);

  const nodes = useMemo<CanvasNode[]>(() => workflow.nodes.map((node) => {
    const definition = definitionByKind.get(node.kind) ?? nodeDefinitions[0];
    return {
      id: node.id,
      type: "automation",
      position: node.position,
      selected: node.id === selectedNodeId,
      data: { label: node.label, kind: node.kind, color: definition.color, icon: definition.icon },
    };
  }), [selectedNodeId, workflow.nodes]);
  const edges = useMemo<FlowEdge[]>(() => workflow.edges.map((edge) => ({ ...edge, animated: false, style: { stroke: "#657080", strokeWidth: 1.7 } })), [workflow.edges]);
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedRun = snapshot.runs.find((run) => run.workflowId === workflow.id);
  const approvals = snapshot.approvals.filter((approval) => approval.workflowId === workflow.id && approval.status === "pending");

  const updateWorkflow = useCallback((updater: (current: AutomationWorkflow) => AutomationWorkflow) => {
    setWorkflow((current) => updater(current));
    setDirty(true);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (!changes.some((change) => change.type === "position" || change.type === "remove")) return;
    const next = applyNodeChanges(changes, nodes);
    const nextIds = new Set(next.map((item) => item.id));
    updateWorkflow((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => nextIds.has(node.id)).map((node) => ({ ...node, position: next.find((item) => item.id === node.id)?.position ?? node.position })),
      edges: current.edges.filter((edge) => nextIds.has(edge.source) && nextIds.has(edge.target)),
    }));
  }, [nodes, updateWorkflow]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const next = applyEdgeChanges(changes, edges);
    updateWorkflow((current) => ({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) }));
  }, [edges, updateWorkflow]);

  const onConnect = useCallback((connection: Connection) => {
    const next = addEdge({ ...connection, id: crypto.randomUUID() }, edges);
    updateWorkflow((current) => ({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) }));
  }, [edges, updateWorkflow]);

  const addNode = useCallback((definition: NodeDefinition, position: { x: number; y: number }) => {
    const node: AutomationNode = { id: crypto.randomUUID(), kind: definition.kind, label: definition.label, position, config: structuredClone(definition.config) };
    updateWorkflow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  }, [updateWorkflow]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/misty-automation-node") as AutomationNodeKind;
    const definition = definitionByKind.get(kind);
    if (definition) addNode(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addNode, screenToFlowPosition]);

  const save = useCallback(async (target = workflow) => {
    setBusy(true);
    try {
      const next = await automationsSaveWorkflow(target);
      setSnapshot(next);
      setWorkflow(next.workflows.find((item) => item.id === target.id) ?? target);
      setDirty(false);
      pushNotification("Automation saved", "success", 2600);
      return next;
    } catch (error) {
      pushNotification(errorMessage(error), "error", 5200);
      throw error;
    } finally { setBusy(false); }
  }, [pushNotification, workflow]);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      if (dirty) await automationsSaveWorkflow(workflow);
      const next = await automationsRun({ workflowId: workflow.id, trigger: "manual", input: {} });
      setSnapshot(next);
      setDirty(false);
      const latest = next.runs.find((item) => item.workflowId === workflow.id);
      pushNotification(latest?.status === "waiting_approval" ? "Automation is waiting for approval" : "Automation run completed", latest?.status === "failed" ? "error" : "success", 4200);
      setLogOpen(true);
    } catch (error) { pushNotification(errorMessage(error), "error", 5200); }
    finally { setBusy(false); }
  }, [dirty, pushNotification, workflow]);

  const resolveApproval = useCallback(async (approval: AutomationApproval, approved: boolean) => {
    setBusy(true);
    try {
      setSnapshot(await automationsResolveApproval(approval.id, approved));
      pushNotification(approved ? "File action approved" : "File action rejected", approved ? "success" : "info", 3200);
    } catch (error) { pushNotification(errorMessage(error), "error", 5200); }
    finally { setBusy(false); }
  }, [pushNotification]);

  if (loading) return <div className="automation-loading">Loading automations...</div>;

  return (
    <main className="automation-shell">
      <header className="automation-toolbar">
        <div className="automation-title-block">
          <input aria-label="Workflow name" className="automation-name" value={workflow.name} onChange={(event) => updateWorkflow((current) => ({ ...current, name: event.target.value }))} />
          <span className={dirty ? "automation-save-state is-dirty" : "automation-save-state"}>{dirty ? "Unsaved" : "Saved"}</span>
        </div>
        <div className="automation-toolbar-actions">
          <label className="automation-enable">
            <input type="checkbox" checked={workflow.enabled} onChange={(event) => updateWorkflow((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>Enabled</span>
          </label>
          <button className="automation-button" disabled={busy} onClick={() => void save()} type="button"><Save size={16} /> Save</button>
          <button className="automation-button automation-button-primary" disabled={busy} onClick={() => void run()} type="button"><CirclePlay size={17} /> Run</button>
        </div>
      </header>

      <aside className="automation-palette">
        <div className="automation-panel-heading"><span>Workflows</span><button title="New workflow" onClick={() => { setWorkflow(createWorkflow()); setSelectedNodeId(undefined); setDirty(true); }} type="button"><Plus size={16} /></button></div>
        <div className="automation-workflow-list">
          {snapshot.workflows.map((item) => <button className={item.id === workflow.id ? "is-active" : ""} key={item.id} onClick={() => { setWorkflow(item); setSelectedNodeId(undefined); setDirty(false); }} type="button"><span>{item.name}</span><small>{item.enabled ? "Active" : "Draft"}</small></button>)}
        </div>
        <div className="automation-panel-heading automation-node-heading"><span>Nodes</span></div>
        <div className="automation-node-library">
          {(["Triggers", "Files", "AI", "Integrations", "Actions"] as const).map((group) => (
            <section key={group}><h3>{group}</h3>{nodeDefinitions.filter((item) => item.group === group).map((definition) => {
              const Icon = definition.icon;
              return <button draggable key={definition.kind} onClick={() => addNode(definition, { x: 120 + workflow.nodes.length * 18, y: 100 + workflow.nodes.length * 24 })} onDragStart={(event) => { event.dataTransfer.setData("application/misty-automation-node", definition.kind); event.dataTransfer.effectAllowed = "copy"; }} type="button"><GripVertical size={13} className="automation-grip" /><span className="automation-library-icon" style={{ color: definition.color }}><Icon size={16} /></span>{definition.label}</button>;
            })}</section>
          ))}
        </div>
      </aside>

      <section className="automation-canvas" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onDrop}>
        <ReactFlow<CanvasNode, FlowEdge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId(undefined)} fitView deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }} minZoom={0.35} maxZoom={1.8}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--automation-grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <AutomationOverview nodes={nodes} />
        {!workflow.nodes.length ? <div className="automation-empty-canvas"><Bot size={25} /><strong>Drop a trigger to begin</strong><span>Drag nodes from the library and connect their handles.</span></div> : null}
      </section>

      <aside className="automation-inspector">
        {selectedNode ? <NodeInspector node={selectedNode} webhookUrl={`${snapshot.webhookUrl}/hooks/${workflow.id}`} onChange={(node) => updateWorkflow((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) }))} onDelete={() => { updateWorkflow((current) => ({ ...current, nodes: current.nodes.filter((item) => item.id !== selectedNode.id), edges: current.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) })); setSelectedNodeId(undefined); }} /> : <WorkflowInspector workflow={workflow} onChange={(next) => updateWorkflow(() => next)} onDelete={snapshot.workflows.some((item) => item.id === workflow.id) ? async () => { setSnapshot(await automationsDeleteWorkflow(workflow.id)); setWorkflow(createWorkflow()); setDirty(true); } : undefined} />}
      </aside>

      <section className={logOpen ? "automation-log is-open" : "automation-log"}>
        <button className="automation-log-toggle" onClick={() => setLogOpen((value) => !value)} type="button"><span>Run log</span><span className={`automation-run-status status-${selectedRun?.status ?? "idle"}`}>{selectedRun?.status?.replace("_", " ") ?? "Not run"}</span><ChevronDown className={logOpen ? "is-open" : ""} size={16} /></button>
        {logOpen ? <div className="automation-log-content">
          {approvals.map((approval) => <div className="automation-approval" key={approval.id}><div><strong>{approval.title}</strong><span>{approval.summary}</span></div><button title="Reject" onClick={() => void resolveApproval(approval, false)} type="button"><X size={16} /></button><button className="approve" title="Approve" onClick={() => void resolveApproval(approval, true)} type="button"><Check size={16} /></button></div>)}
          {selectedRun?.nodeRuns.map((node) => <div className="automation-log-row" key={`${selectedRun.id}-${node.nodeId}`}><span className={`automation-log-dot status-${node.status}`} /><strong>{node.label}</strong><span>{node.error ?? node.status.replace("_", " ")}</span></div>)}
          {!selectedRun ? <div className="automation-log-empty">Run the workflow to inspect node outputs and errors.</div> : null}
        </div> : null}
      </section>
    </main>
  );
}

function AutomationCanvasNode({ data, selected }: NodeProps<CanvasNode>) {
  const Icon = data.icon;
  const trigger = data.kind.endsWith("_trigger");
  return <div className={selected ? "automation-flow-node is-selected" : "automation-flow-node"} style={{ "--node-color": data.color } as React.CSSProperties}>
    {!trigger ? <Handle type="target" position={Position.Left} /> : null}
    <span className="automation-flow-icon"><Icon size={17} /></span><div><strong>{data.label}</strong><small>{nodeCategory(data.kind)}</small></div>
    <Handle type="source" position={Position.Right} />
  </div>;
}

function AutomationOverview({ nodes }: { nodes: CanvasNode[] }) {
  const viewport = useViewport();
  const flowWidth = useStore((state) => state.width);
  const flowHeight = useStore((state) => state.height);
  const { setCenter } = useReactFlow<CanvasNode, FlowEdge>();
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const overviewWidth = 164;
  const overviewHeight = 104;
  const inset = 8;
  const nodeWidth = 184;
  const nodeHeight = 58;

  const geometry = useMemo(() => {
    const zoom = Math.max(viewport.zoom, 0.01);
    const visible = {
      x: -viewport.x / zoom,
      y: -viewport.y / zoom,
      width: flowWidth / zoom,
      height: flowHeight / zoom,
    };
    const minX = Math.min(visible.x, ...nodes.map((node) => node.position.x));
    const minY = Math.min(visible.y, ...nodes.map((node) => node.position.y));
    const maxX = Math.max(visible.x + visible.width, ...nodes.map((node) => node.position.x + nodeWidth));
    const maxY = Math.max(visible.y + visible.height, ...nodes.map((node) => node.position.y + nodeHeight));
    const rawWidth = Math.max(maxX - minX, 1);
    const rawHeight = Math.max(maxY - minY, 1);
    const padding = Math.max(32, Math.min(120, Math.max(rawWidth, rawHeight) * 0.06));
    const world = {
      x: minX - padding,
      y: minY - padding,
      width: rawWidth + padding * 2,
      height: rawHeight + padding * 2,
    };
    const scale = Math.min((overviewWidth - inset * 2) / world.width, (overviewHeight - inset * 2) / world.height);
    const offsetX = (overviewWidth - world.width * scale) / 2;
    const offsetY = (overviewHeight - world.height * scale) / 2;
    const project = (x: number, y: number) => ({ x: offsetX + (x - world.x) * scale, y: offsetY + (y - world.y) * scale });
    return { visible, world, scale, project };
  }, [flowHeight, flowWidth, nodes, viewport.x, viewport.y, viewport.zoom]);
  const dragGeometryRef = useRef<typeof geometry | null>(null);

  const recenterAt = useCallback((clientX: number, clientY: number, element: HTMLButtonElement, duration: number) => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const activeGeometry = dragGeometryRef.current ?? geometry;
    const svgX = ((clientX - bounds.left) / bounds.width) * overviewWidth;
    const svgY = ((clientY - bounds.top) / bounds.height) * overviewHeight;
    const worldX = activeGeometry.world.x + (svgX - (overviewWidth - activeGeometry.world.width * activeGeometry.scale) / 2) / activeGeometry.scale;
    const worldY = activeGeometry.world.y + (svgY - (overviewHeight - activeGeometry.world.height * activeGeometry.scale) / 2) / activeGeometry.scale;
    void setCenter(worldX, worldY, { zoom: viewport.zoom, duration });
  }, [geometry, setCenter, viewport.zoom]);

  const stopDragging = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    draggingRef.current = false;
    dragGeometryRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const visibleOrigin = geometry.project(geometry.visible.x, geometry.visible.y);
  return (
    <button
      className={dragging ? "automation-overview is-dragging" : "automation-overview"}
      onPointerCancel={stopDragging}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragGeometryRef.current = geometry;
        draggingRef.current = true;
        setDragging(true);
        recenterAt(event.clientX, event.clientY, event.currentTarget, 0);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        recenterAt(event.clientX, event.clientY, event.currentTarget, 0);
      }}
      onPointerUp={stopDragging}
      title="Drag to pan the canvas"
      type="button"
      aria-label="Workflow overview"
    >
      <svg aria-hidden="true" viewBox={`0 0 ${overviewWidth} ${overviewHeight}`}>
        <defs><pattern id="automation-overview-grid" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.55" /></pattern></defs>
        <rect className="automation-overview-bg" width={overviewWidth} height={overviewHeight} />
        <rect className="automation-overview-grid" width={overviewWidth} height={overviewHeight} />
        {nodes.map((node) => {
          const point = geometry.project(node.position.x, node.position.y);
          return <rect className="automation-overview-node" fill={node.data.color} key={node.id} x={point.x} y={point.y} width={Math.max(nodeWidth * geometry.scale, 5)} height={Math.max(nodeHeight * geometry.scale, 3)} rx={2} />;
        })}
        <rect className="automation-overview-viewport" x={visibleOrigin.x} y={visibleOrigin.y} width={Math.max(geometry.visible.width * geometry.scale, 4)} height={Math.max(geometry.visible.height * geometry.scale, 4)} rx={2} />
      </svg>
    </button>
  );
}

function WorkflowInspector({ workflow, onChange, onDelete }: { workflow: AutomationWorkflow; onChange: (value: AutomationWorkflow) => void; onDelete?: () => void | Promise<void> }) {
  return <><div className="automation-inspector-heading"><div><span>Workflow</span><strong>Settings</strong></div>{onDelete ? <button title="Delete workflow" onClick={() => void onDelete()} type="button"><Trash2 size={16} /></button> : null}</div>
    <Field label="Description"><textarea rows={3} value={workflow.description} onChange={(event) => onChange({ ...workflow, description: event.target.value })} /></Field>
    <Field label="Schedule interval"><select value={workflow.intervalMinutes ?? ""} onChange={(event) => onChange({ ...workflow, intervalMinutes: event.target.value ? Number(event.target.value) : undefined })}><option value="">Manual only</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440">Daily</option></select></Field>
    <p className="automation-inspector-note">Schedules run while Misty is open. Missed intervals are not backfilled.</p>
  </>;
}

function NodeInspector({ node, webhookUrl, onChange, onDelete }: { node: AutomationNode; webhookUrl: string; onChange: (value: AutomationNode) => void; onDelete: () => void }) {
  const updateConfig = (key: string, value: unknown) => onChange({ ...node, config: { ...node.config, [key]: value } });
  return <><div className="automation-inspector-heading"><div><span>Node</span><strong>{node.label}</strong></div><button title="Delete node" onClick={onDelete} type="button"><Trash2 size={16} /></button></div>
    <Field label="Label"><input value={node.label} onChange={(event) => onChange({ ...node, label: event.target.value })} /></Field>
    {node.kind === "webhook_trigger" ? <Field label="Local webhook URL"><input readOnly value={webhookUrl} /></Field> : null}
    {node.kind === "select_path" ? <Field label="Paths (one per line)"><textarea rows={5} value={stringArray(node.config.paths).join("\n")} onChange={(event) => updateConfig("paths", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></Field> : null}
    {hasConfig(node.kind, "path") ? <Field label="Path"><input value={configString(node, "path")} onChange={(event) => updateConfig("path", event.target.value)} /></Field> : null}
    {node.kind === "filter" ? <Field label="Contains"><input value={configString(node, "contains")} onChange={(event) => updateConfig("contains", event.target.value)} /></Field> : null}
    {node.kind === "structured_prompt" ? <><Field label="Prompt"><textarea rows={9} value={configString(node, "prompt")} onChange={(event) => updateConfig("prompt", event.target.value)} /></Field><Field label="Working directory"><input placeholder="Optional" value={configString(node, "cwd")} onChange={(event) => updateConfig("cwd", event.target.value)} /></Field></> : null}
    {node.kind === "http_request" ? <><Field label="Method"><select value={configString(node, "method")} onChange={(event) => updateConfig("method", event.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></Field><Field label="URL"><input placeholder="https://api.example.com" value={configString(node, "url")} onChange={(event) => updateConfig("url", event.target.value)} /></Field><Field label="Body"><textarea rows={5} value={configString(node, "body")} onChange={(event) => updateConfig("body", event.target.value)} /></Field></> : null}
    {hasConfig(node.kind, "source") ? <Field label="Source"><input value={configString(node, "source")} onChange={(event) => updateConfig("source", event.target.value)} /></Field> : null}
    {hasConfig(node.kind, "destination") ? <Field label="Destination"><input value={configString(node, "destination")} onChange={(event) => updateConfig("destination", event.target.value)} /></Field> : null}
    {node.kind === "write_text" ? <Field label="Text"><textarea rows={6} value={configString(node, "text")} onChange={(event) => updateConfig("text", event.target.value)} /></Field> : null}
    {node.kind === "notify" ? <Field label="Message"><textarea rows={4} value={configString(node, "message")} onChange={(event) => updateConfig("message", event.target.value)} /></Field> : null}
    <p className="automation-inspector-note">Use <code>{"{{input}}"}</code> for the previous node output, or keys such as <code>{"{{text}}"}</code>.</p>
    {["write_text", "copy_path", "move_path", "rename_path"].includes(node.kind) ? <div className="automation-safety-note">This action always requires approval when a run reaches it.</div> : null}
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="automation-field"><span>{label}</span>{children}</label>; }

function createWorkflow(): AutomationWorkflow {
  const id = crypto.randomUUID();
  return { id, name: "Untitled automation", description: "", enabled: false, nodes: [{ id: crypto.randomUUID(), kind: "manual_trigger", label: "Manual trigger", position: { x: 100, y: 150 }, config: {} }], edges: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function hasConfig(kind: AutomationNodeKind, field: string) { return field in (definitionByKind.get(kind)?.config ?? {}); }
function configString(node: AutomationNode, key: string) { return typeof node.config[key] === "string" ? node.config[key] as string : ""; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function nodeCategory(kind: AutomationNodeKind) { return definitionByKind.get(kind)?.group ?? "Node"; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
