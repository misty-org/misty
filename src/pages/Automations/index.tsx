import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ClipboardPaste,
  ClipboardX,
  Clock3,
  Copy,
  CopyPlus,
  FileInput,
  FileOutput,
  Filter,
  FolderOpen,
  Globe2,
  GripVertical,
  HardDrive,
  ListTree,
  MessageSquare,
  Maximize2,
  Move,
  Plus,
  Redo2,
  Save,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
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
  AutomationPosition,
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

type PaletteNodeDrag = {
  definition: NodeDefinition;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};

type InspectorPosition = {
  left: number;
  top: number;
  maxHeight: number;
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [disconnectMode, setDisconnectMode] = useState(false);
  const [undoStack, setUndoStack] = useState<AutomationWorkflow[]>([]);
  const [redoStack, setRedoStack] = useState<AutomationWorkflow[]>([]);
  const [nodeClipboard, setNodeClipboard] = useState<AutomationNode | null>(null);
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [inspectorPosition, setInspectorPosition] = useState<InspectorPosition | null>(null);
  const nodeDragStartRef = useRef<AutomationWorkflow | null>(null);
  const nodeInspectorRef = useRef<HTMLElement | null>(null);
  const workflowSettingsRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [logHeight, setLogHeight] = useState(190);
  const [resizingLog, setResizingLog] = useState(false);
  const logResizeRef = useRef({ pointerY: 0, height: 190 });
  const logResizeActiveRef = useRef(false);
  const [paletteDrag, setPaletteDrag] = useState<PaletteNodeDrag | null>(null);
  const paletteDragRef = useRef<PaletteNodeDrag | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const canvasViewport = useViewport();
  const { fitView, screenToFlowPosition } = useReactFlow<CanvasNode, FlowEdge>();
  const pushNotification = useExplorerStore((state) => state.pushNotification);

  const loadSnapshot = useCallback(async () => {
    try {
      const next = await automationsSnapshot();
      setSnapshot(next);
      setWorkflow((current) => next.workflows.find((item) => item.id === current.id) ?? next.workflows[0] ?? current);
      setUndoStack([]);
      setRedoStack([]);
    } catch (error) {
      pushNotification(errorMessage(error), "error", 5200);
    } finally {
      setLoading(false);
    }
  }, [pushNotification]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    if (!workflowSettingsOpen) return;
    const close = (event: MouseEvent) => {
      if (workflowSettingsRef.current?.contains(event.target as Node)) return;
      setWorkflowSettingsOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [workflowSettingsOpen]);

  useEffect(() => {
    if (!resizingLog) return;
    const resize = (event: MouseEvent) => {
      if (!logResizeActiveRef.current) return;
      const maximum = Math.max(190, window.innerHeight * 0.62);
      setLogHeight(Math.min(maximum, Math.max(100, logResizeRef.current.height + logResizeRef.current.pointerY - event.clientY)));
    };
    const stop = () => {
      logResizeActiveRef.current = false;
      setResizingLog(false);
    };
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [resizingLog]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void automationsSnapshot()
        .then(setSnapshot)
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

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
  const edges = useMemo<FlowEdge[]>(() => workflow.edges.map((edge) => ({
    ...edge,
    animated: false,
    selected: edge.id === selectedEdgeId,
    className: disconnectMode ? "is-disconnectable" : "",
    style: { stroke: edge.id === selectedEdgeId ? "var(--misty-accent)" : "#657080", strokeWidth: edge.id === selectedEdgeId ? 2.4 : 1.7 },
  })), [disconnectMode, selectedEdgeId, workflow.edges]);
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedRun = snapshot.runs.find((run) => run.workflowId === workflow.id);
  const approvals = snapshot.approvals.filter((approval) => approval.workflowId === workflow.id && approval.status === "pending");
  const PaletteDragIcon = paletteDrag?.definition.icon;

  useLayoutEffect(() => {
    if (!selectedNodeId || !selectedNode || !canvasRef.current) {
      setInspectorPosition(null);
      return;
    }
    let frame = 0;
    const place = () => {
      const canvas = canvasRef.current;
      const inspector = nodeInspectorRef.current;
      const anchor = canvas?.querySelector<HTMLElement>(`.react-flow__node[data-id="${selectedNodeId}"]`);
      if (!canvas || !anchor) return;
      const canvasBounds = canvas.getBoundingClientRect();
      const anchorBounds = anchor.getBoundingClientRect();
      const width = Math.min(300, Math.max(240, canvasBounds.width - 20));
      const maxHeight = Math.max(180, Math.min(520, canvasBounds.height - 20));
      const measuredHeight = Math.min(inspector?.scrollHeight ?? 360, maxHeight);
      const below = canvasBounds.bottom - anchorBounds.bottom;
      const above = anchorBounds.top - canvasBounds.top;
      const right = canvasBounds.right - anchorBounds.right;
      const left = anchorBounds.left - canvasBounds.left;
      const requiredVerticalSpace = measuredHeight + 10;
      const requiredHorizontalSpace = width + 10;
      let popupLeft = anchorBounds.left - canvasBounds.left;
      let popupTop = anchorBounds.bottom - canvasBounds.top + 10;
      let popupMaxHeight = maxHeight;

      if (below >= requiredVerticalSpace) {
        // Keep the common path visually connected to the bottom edge of the node.
      } else if (above >= requiredVerticalSpace) {
        popupTop = anchorBounds.top - canvasBounds.top - measuredHeight - 10;
      } else if (right >= requiredHorizontalSpace) {
        popupLeft = anchorBounds.right - canvasBounds.left + 10;
        popupTop = anchorBounds.top - canvasBounds.top + (anchorBounds.height - measuredHeight) / 2;
      } else if (left >= requiredHorizontalSpace) {
        popupLeft = anchorBounds.left - canvasBounds.left - width - 10;
        popupTop = anchorBounds.top - canvasBounds.top + (anchorBounds.height - measuredHeight) / 2;
      } else if (below >= above) {
        popupMaxHeight = Math.max(140, below - 20);
      } else {
        popupMaxHeight = Math.max(140, above - 20);
        popupTop = anchorBounds.top - canvasBounds.top - popupMaxHeight - 10;
      }
      setInspectorPosition({
        left: Math.max(10, Math.min(popupLeft, canvasBounds.width - width - 10)),
        top: Math.max(10, Math.min(popupTop, canvasBounds.height - Math.min(measuredHeight, popupMaxHeight) - 10)),
        maxHeight: popupMaxHeight,
      });
    };
    frame = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [canvasViewport.x, canvasViewport.y, canvasViewport.zoom, logHeight, logOpen, selectedNode, selectedNodeId, workflow.nodes]);

  const updateWorkflow = useCallback((updater: (current: AutomationWorkflow) => AutomationWorkflow) => {
    const next = updater(workflow);
    if (next === workflow) return;
    setUndoStack((current) => [...current, workflow].slice(-60));
    setRedoStack([]);
    setWorkflow(next);
    setDirty(true);
  }, [workflow]);

  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [workflow, ...current].slice(0, 60));
    setWorkflow(previous);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setDirty(true);
  }, [undoStack, workflow]);

  const redo = useCallback(() => {
    const next = redoStack[0];
    if (!next) return;
    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, workflow].slice(-60));
    setWorkflow(next);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setDirty(true);
  }, [redoStack, workflow]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (!changes.some((change) => change.type === "position" || change.type === "remove")) return;
    const next = applyNodeChanges(changes, nodes);
    const nextIds = new Set(next.map((item) => item.id));
    const apply = (current: AutomationWorkflow) => ({
      ...current,
      nodes: current.nodes.filter((node) => nextIds.has(node.id)).map((node) => ({ ...node, position: next.find((item) => item.id === node.id)?.position ?? node.position })),
      edges: current.edges.filter((edge) => nextIds.has(edge.source) && nextIds.has(edge.target)),
    });
    if (changes.some((change) => change.type === "remove")) updateWorkflow(apply);
    else {
      setWorkflow(apply);
      setDirty(true);
    }
  }, [nodes, updateWorkflow]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    if (!changes.some((change) => change.type === "remove")) return;
    const next = applyEdgeChanges(changes, edges);
    updateWorkflow((current) => ({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) }));
  }, [edges, updateWorkflow]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (workflow.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
      pushNotification("Those nodes are already connected", "info", 2600);
      return;
    }
    const next = addEdge({ ...connection, id: crypto.randomUUID() }, edges);
    updateWorkflow((current) => ({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) }));
  }, [edges, pushNotification, updateWorkflow, workflow.edges]);

  const addNode = useCallback((definition: NodeDefinition, position: { x: number; y: number }) => {
    const node: AutomationNode = { id: crypto.randomUUID(), kind: definition.kind, label: definition.label, position, config: structuredClone(definition.config) };
    updateWorkflow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  }, [updateWorkflow]);

  const deleteSelection = useCallback(() => {
    if (selectedNodeId) {
      updateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== selectedNodeId),
        edges: current.edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
      }));
      setSelectedNodeId(undefined);
      return;
    }
    if (selectedEdgeId) {
      updateWorkflow((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdgeId) }));
      setSelectedEdgeId(undefined);
    }
  }, [selectedEdgeId, selectedNodeId, updateWorkflow]);

  const copySelection = useCallback((notify = true) => {
    const node = workflow.nodes.find((item) => item.id === selectedNodeId);
    if (!node) return;
    setNodeClipboard(structuredClone(node));
    if (notify) pushNotification("Node copied", "success", 1800);
  }, [pushNotification, selectedNodeId, workflow.nodes]);

  const pasteNode = useCallback(() => {
    if (!nodeClipboard) return;
    const node: AutomationNode = {
      ...structuredClone(nodeClipboard),
      id: crypto.randomUUID(),
      position: { x: nodeClipboard.position.x + 32, y: nodeClipboard.position.y + 32 },
    };
    updateWorkflow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setNodeClipboard(structuredClone(node));
    setSelectedNodeId(node.id);
    setSelectedEdgeId(undefined);
  }, [nodeClipboard, updateWorkflow]);

  const duplicateSelection = useCallback(() => {
    const node = workflow.nodes.find((item) => item.id === selectedNodeId);
    if (!node) return;
    const duplicate: AutomationNode = {
      ...structuredClone(node),
      id: crypto.randomUUID(),
      label: `${node.label} copy`,
      position: { x: node.position.x + 32, y: node.position.y + 32 },
    };
    updateWorkflow((current) => ({ ...current, nodes: [...current.nodes, duplicate] }));
    setSelectedNodeId(duplicate.id);
    setSelectedEdgeId(undefined);
  }, [selectedNodeId, updateWorkflow, workflow.nodes]);

  const cutSelection = useCallback(() => {
    if (!selectedNodeId) return;
    copySelection(false);
    deleteSelection();
  }, [copySelection, deleteSelection, selectedNodeId]);

  const handleEdgeClick = useCallback((edgeId: string) => {
    if (disconnectMode) {
      updateWorkflow((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
      setSelectedEdgeId(undefined);
      pushNotification("Connection removed", "success", 1800);
      return;
    }
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(undefined);
  }, [disconnectMode, pushNotification, updateWorkflow]);

  const startNodeDrag = useCallback(() => {
    nodeDragStartRef.current = workflow;
  }, [workflow]);

  const finishNodeDrag = useCallback((node: CanvasNode) => {
    const initial = nodeDragStartRef.current;
    nodeDragStartRef.current = null;
    const initialNode = initial?.nodes.find((item) => item.id === node.id);
    if (!initial || !initialNode || (initialNode.position.x === node.position.x && initialNode.position.y === node.position.y)) return;
    setUndoStack((current) => [...current, initial].slice(-60));
    setRedoStack([]);
  }, []);

  const beginPaletteDrag = useCallback((event: React.MouseEvent<HTMLButtonElement>, definition: NodeDefinition) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const drag = { definition, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    paletteDragRef.current = drag;
    setPaletteDrag(drag);
  }, []);

  useEffect(() => {
    if (!paletteDrag) return;
    const move = (event: MouseEvent) => {
      const current = paletteDragRef.current;
      if (!current) return;
      const active = current.active || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 6;
      const next = { ...current, x: event.clientX, y: event.clientY, active };
      paletteDragRef.current = next;
      setPaletteDrag(next);
    };
    const finish = (event: MouseEvent) => {
      const current = paletteDragRef.current;
      if (!current) return;
      if (current.active) {
        const bounds = canvasRef.current?.getBoundingClientRect();
        if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
          addNode(current.definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }
      } else {
        addNode(current.definition, findOpenNodePosition(workflow.nodes));
        window.requestAnimationFrame(() => {
          void fitView({ padding: 0.18, duration: 180 });
        });
      }
      paletteDragRef.current = null;
      setPaletteDrag(null);
    };
    const cancel = () => {
      paletteDragRef.current = null;
      setPaletteDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", cancel);
    };
  }, [addNode, fitView, paletteDrag !== null, screenToFlowPosition, workflow.nodes]);

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
      const notificationMessages = latest?.nodeRuns
        .map((node) => outputMessage(node.output))
        .filter(Boolean) ?? [];
      const notificationMessage = notificationMessages[notificationMessages.length - 1];
      pushNotification(
        latest?.status === "waiting_approval"
          ? "Automation is waiting for approval"
          : latest?.status === "failed"
            ? latest.error || "Automation run failed"
            : notificationMessage || "Automation run completed",
        latest?.status === "failed" ? "error" : "success",
        4200,
      );
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

  const deleteCurrentWorkflow = useCallback(async () => {
    setBusy(true);
    try {
      const next = await automationsDeleteWorkflow(workflow.id);
      setSnapshot(next);
      setWorkflow(createWorkflow());
      setSelectedNodeId(undefined);
      setSelectedEdgeId(undefined);
      setUndoStack([]);
      setRedoStack([]);
      setWorkflowSettingsOpen(false);
      setDirty(true);
      pushNotification("Automation deleted", "success", 2600);
    } catch (error) {
      pushNotification(errorMessage(error), "error", 5200);
    } finally {
      setBusy(false);
    }
  }, [pushNotification, workflow.id]);

  const discardChanges = useCallback(() => (
    !dirty || window.confirm("Discard the unsaved changes to this automation?")
  ), [dirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDisconnectMode(false);
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
        setWorkflowSettingsOpen(false);
        return;
      }
      if (isEditableElement(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && key === "y") {
        event.preventDefault();
        redo();
      } else if (command && key === "c") {
        event.preventDefault();
        copySelection();
      } else if (command && key === "x") {
        event.preventDefault();
        cutSelection();
      } else if (command && key === "v") {
        event.preventDefault();
        pasteNode();
      } else if (command && key === "d") {
        event.preventDefault();
        duplicateSelection();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelection, cutSelection, deleteSelection, duplicateSelection, pasteNode, redo, undo]);

  if (loading) return <div className="automation-loading">Loading automations...</div>;

  return (
    <main className={resizingLog ? "automation-shell is-resizing-log" : "automation-shell"} style={{ "--automation-log-height": `${logOpen ? logHeight : 38}px` } as React.CSSProperties}>
      <header className="automation-toolbar">
        <div className="automation-title-block">
          <input aria-label="Workflow name" className="automation-name" value={workflow.name} onChange={(event) => updateWorkflow((current) => ({ ...current, name: event.target.value }))} />
          <span className={dirty ? "automation-save-state is-dirty" : "automation-save-state"}>{dirty ? "Unsaved" : "Saved"}</span>
        </div>
        <div className="automation-edit-toolbar" role="toolbar" aria-label="Workflow editing tools">
          <EditorToolButton disabled={!undoStack.length} icon={Undo2} label="Undo" onClick={undo} shortcut="Cmd+Z" />
          <EditorToolButton disabled={!redoStack.length} icon={Redo2} label="Redo" onClick={redo} shortcut="Cmd+Shift+Z" />
          <span className="automation-tool-separator" />
          <EditorToolButton disabled={!selectedNode} icon={Copy} label="Copy node" onClick={() => copySelection()} shortcut="Cmd+C" />
          <EditorToolButton disabled={!selectedNode} icon={ClipboardX} label="Cut node" onClick={cutSelection} shortcut="Cmd+X" />
          <EditorToolButton disabled={!nodeClipboard} icon={ClipboardPaste} label="Paste node" onClick={pasteNode} shortcut="Cmd+V" />
          <EditorToolButton disabled={!selectedNode} icon={CopyPlus} label="Duplicate node" onClick={duplicateSelection} shortcut="Cmd+D" />
          <EditorToolButton disabled={!selectedNode && !selectedEdgeId} icon={Trash2} label="Delete selection" onClick={deleteSelection} shortcut="Delete" />
          <span className="automation-tool-separator" />
          <EditorToolButton active={disconnectMode} icon={Scissors} label="Disconnect connections" onClick={() => setDisconnectMode((current) => !current)} shortcut="Esc to exit" />
          <EditorToolButton icon={Maximize2} label="Fit workflow to view" onClick={() => void fitView({ padding: 0.18, duration: 180 })} />
          <div className="automation-workflow-settings-anchor" ref={workflowSettingsRef}>
            <EditorToolButton active={workflowSettingsOpen} icon={Settings2} label="Workflow settings" onClick={() => setWorkflowSettingsOpen((current) => !current)} />
            {workflowSettingsOpen ? <aside className="automation-workflow-settings-popover" aria-label="Workflow settings">
              <WorkflowInspector workflow={workflow} onChange={(next) => updateWorkflow(() => next)} onDelete={snapshot.workflows.some((item) => item.id === workflow.id) ? deleteCurrentWorkflow : undefined} />
            </aside> : null}
          </div>
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
        <div className="automation-panel-heading"><span>Workflows</span><button title="New workflow" onClick={() => { if (!discardChanges()) return; setWorkflow(createWorkflow()); setSelectedNodeId(undefined); setSelectedEdgeId(undefined); setUndoStack([]); setRedoStack([]); setWorkflowSettingsOpen(false); setDirty(true); }} type="button"><Plus size={16} /></button></div>
        <div className="automation-workflow-list">
          {snapshot.workflows.map((item) => <button className={item.id === workflow.id ? "is-active" : ""} key={item.id} onClick={() => { if (item.id === workflow.id || !discardChanges()) return; setWorkflow(item); setSelectedNodeId(undefined); setSelectedEdgeId(undefined); setUndoStack([]); setRedoStack([]); setWorkflowSettingsOpen(false); setDirty(false); }} type="button"><span>{item.name}</span><small>{item.enabled ? "Active" : "Draft"}</small></button>)}
        </div>
        <div className="automation-panel-heading automation-node-heading"><span>Nodes</span></div>
        <div className="automation-node-library">
          {(["Triggers", "Files", "AI", "Integrations", "Actions"] as const).map((group) => (
            <section key={group}><h3>{group}</h3>{nodeDefinitions.filter((item) => item.group === group).map((definition) => {
              const Icon = definition.icon;
              return <button key={definition.kind} onMouseDown={(event) => beginPaletteDrag(event, definition)} type="button"><GripVertical size={13} className="automation-grip" /><span className="automation-library-icon" style={{ color: definition.color }}><Icon size={16} /></span>{definition.label}</button>;
            })}</section>
          ))}
        </div>
      </aside>

      <section ref={canvasRef} className={`automation-canvas${paletteDrag?.active ? " is-palette-drop-target" : ""}${disconnectMode ? " is-disconnecting" : ""}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onDrop}>
        <ReactFlow<CanvasNode, FlowEdge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onEdgeClick={(_, edge) => handleEdgeClick(edge.id)}
          onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(undefined); }}
          onNodeDragStart={startNodeDrag}
          onNodeDragStop={(_, node) => finishNodeDrag(node)}
          onPaneClick={() => { setSelectedNodeId(undefined); setSelectedEdgeId(undefined); }} fitView deleteKeyCode={null}
          proOptions={{ hideAttribution: true }} minZoom={0.35} maxZoom={1.8}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--automation-grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <AutomationOverview nodes={nodes} />
        {selectedNode ? <aside
          aria-label={`${selectedNode.label} settings`}
          className="automation-node-popover"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          ref={nodeInspectorRef}
          style={{
            left: inspectorPosition?.left ?? 10,
            top: inspectorPosition?.top ?? 10,
            maxHeight: inspectorPosition?.maxHeight ?? 360,
            visibility: inspectorPosition ? "visible" : "hidden",
          }}
        ><NodeInspector node={selectedNode} webhookUrl={`${snapshot.webhookUrl}/hooks/${workflow.id}`} onChange={(node) => updateWorkflow((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) }))} onDelete={() => {
          updateWorkflow((current) => ({ ...current, nodes: current.nodes.filter((item) => item.id !== selectedNode.id), edges: current.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) }));
          setSelectedNodeId(undefined);
        }} /></aside> : null}
        {!workflow.nodes.length ? <div className="automation-empty-canvas"><Bot size={25} /><strong>Drop a trigger to begin</strong><span>Drag nodes from the library and connect their handles.</span></div> : null}
      </section>

      {paletteDrag?.active && PaletteDragIcon ? <div className="automation-node-drag-preview" style={{ left: paletteDrag.x, top: paletteDrag.y, "--node-color": paletteDrag.definition.color } as React.CSSProperties}>
        <PaletteDragIcon size={16} /><span>{paletteDrag.definition.label}</span>
      </div> : null}

      <section className={logOpen ? "automation-log is-open" : "automation-log"}>
        {logOpen ? <button
          aria-label="Resize run log"
          className="automation-log-resize"
          onDoubleClick={() => setLogHeight(190)}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            logResizeRef.current = { pointerY: event.clientY, height: logHeight };
            logResizeActiveRef.current = true;
            setResizingLog(true);
          }}
          title="Drag to resize; double-click to reset"
          type="button"
        ><span /></button> : null}
        <button className="automation-log-toggle" onClick={() => setLogOpen((value) => !value)} type="button"><span>Run log</span><span className={`automation-run-status status-${selectedRun?.status ?? "idle"}`}>{selectedRun?.status?.replace("_", " ") ?? "Not run"}</span><ChevronDown className={logOpen ? "is-open" : ""} size={16} /></button>
        {logOpen ? <div className="automation-log-content">
          {approvals.map((approval) => <div className="automation-approval" key={approval.id}><div><strong>{approval.title}</strong><span>{approval.summary}</span></div><button title="Reject" onClick={() => void resolveApproval(approval, false)} type="button"><X size={16} /></button><button className="approve" title="Approve" onClick={() => void resolveApproval(approval, true)} type="button"><Check size={16} /></button></div>)}
          {selectedRun?.nodeRuns.map((node) => <details className="automation-log-row" key={`${selectedRun.id}-${node.nodeId}`}>
            <summary><span className={`automation-log-dot status-${node.status}`} /><strong>{node.label}</strong><span>{node.error ?? node.status.replace("_", " ")}</span><ChevronDown size={13} /></summary>
            <pre>{node.error ?? (formatAutomationOutput(node.output) || "No output returned.")}</pre>
          </details>)}
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
    <p className="automation-inspector-note">Schedules run while Misty is open, even when this page is closed. Missed intervals run once and are not backfilled.</p>
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
    {node.kind === "structured_prompt" ? <><p className="automation-field-help">This node uses Misty credits. Local and non-AI automation nodes are unmetered.</p><Field label="Prompt"><textarea rows={9} value={configString(node, "prompt")} onChange={(event) => updateConfig("prompt", event.target.value)} /></Field><Field label="Working directory"><input placeholder="Optional" value={configString(node, "cwd")} onChange={(event) => updateConfig("cwd", event.target.value)} /></Field></> : null}
    {node.kind === "http_request" ? <><Field label="Method"><select value={configString(node, "method")} onChange={(event) => updateConfig("method", event.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></Field><Field label="URL"><input placeholder="https://api.example.com" value={configString(node, "url")} onChange={(event) => updateConfig("url", event.target.value)} /></Field><Field label="Body"><textarea rows={5} value={configString(node, "body")} onChange={(event) => updateConfig("body", event.target.value)} /></Field></> : null}
    {hasConfig(node.kind, "source") ? <Field label="Source"><input value={configString(node, "source")} onChange={(event) => updateConfig("source", event.target.value)} /></Field> : null}
    {hasConfig(node.kind, "destination") ? <Field label="Destination"><input value={configString(node, "destination")} onChange={(event) => updateConfig("destination", event.target.value)} /></Field> : null}
    {node.kind === "write_text" ? <Field label="Text"><textarea rows={6} value={configString(node, "text")} onChange={(event) => updateConfig("text", event.target.value)} /></Field> : null}
    {node.kind === "notify" ? <Field label="Message"><textarea rows={4} value={configString(node, "message")} onChange={(event) => updateConfig("message", event.target.value)} /></Field> : null}
    <p className="automation-inspector-note">Use <code>{"{{input}}"}</code> for the previous node output, or keys such as <code>{"{{text}}"}</code>.</p>
    {["write_text", "copy_path", "move_path", "rename_path"].includes(node.kind) ? <div className="automation-safety-note">This action always requires approval when a run reaches it.</div> : null}
  </>;
}

function EditorToolButton(props: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const Icon = props.icon;
  const title = props.shortcut ? `${props.label} (${props.shortcut})` : props.label;
  return <button aria-label={props.label} aria-pressed={props.active || undefined} className={props.active ? "automation-tool-button is-active" : "automation-tool-button"} disabled={props.disabled} onClick={props.onClick} title={title} type="button"><Icon size={16} /></button>;
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

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function outputMessage(output: unknown): string {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const message = (output as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}

function formatAutomationOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output;
  if (typeof output === "number" || typeof output === "boolean") return String(output);
  if (typeof output === "object" && !Array.isArray(output)) {
    const value = output as Record<string, unknown>;
    for (const key of ["message", "text", "body", "value"]) {
      if (typeof value[key] === "string") return value[key];
    }
  }
  try { return JSON.stringify(output, null, 2); }
  catch { return String(output); }
}

function findOpenNodePosition(nodes: AutomationNode[]): AutomationPosition {
  const columns = 3;
  const horizontalGap = 240;
  const verticalGap = 140;
  for (let index = 0; index < 120; index += 1) {
    const candidate = {
      x: 100 + (index % columns) * horizontalGap,
      y: 100 + Math.floor(index / columns) * verticalGap,
    };
    const occupied = nodes.some((node) => (
      Math.abs(node.position.x - candidate.x) < 200
      && Math.abs(node.position.y - candidate.y) < 100
    ));
    if (!occupied) return candidate;
  }
  return { x: 100, y: 100 + Math.ceil(nodes.length / columns) * verticalGap };
}
