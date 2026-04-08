import type {
  CanvasData,
  CanvasNode,
  PaletteDefinition,
  EditorCategory,
} from "@/models/types/pages/Studio/UnifiedWorkflowEditor";
export type {
  CanvasData,
  CanvasNode,
  PaletteDefinition,
  EditorCategory,
} from "@/models/types/pages/Studio/UnifiedWorkflowEditor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Check,
  ChevronDown,
  CirclePlay,
  Clipboard,
  Copy,
  CopyPlus,
  FileInput,
  FileOutput,
  Filter,
  FolderOpen,
  Globe2,
  GripVertical,
  HardDrive,
  History,
  ListTree,
  MessageSquare,
  Move,
  Plus,
  Redo2,
  Save,
  Scissors,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Unlink,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { errorText } from "@/lib/format";
import { confirmAction } from "@/lib/confirmAction";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import type { WorkflowMetadata } from "@/models/interfaces/features/spaces/types";
import type { SpaceStudioResource } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { workflowTemplates } from "../../features/workflows/templates";
import { providerById, providerNodeTemplates } from "../../features/workflows/providers";
import type { ProviderNodeTemplate } from "@/models/interfaces/features/workflows/providers";
import {
  createConfiguredWorkflowNode,
  createWorkflowNode,
  validateWorkflowV2,
  workflowNodeRegistry,
} from "../../features/workflows/v2";
import type { WorkflowNodeKind } from "@/models/types/features/workflows/v2";
import type {
  WorkflowDefinitionV2,
  WorkflowNodeDescriptor,
  WorkflowNodeV2,
} from "@/models/interfaces/features/workflows/v2";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import { Input } from "@/ui";
import { Textarea } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";

const emptyWorkflowResources: SpaceStudioResource[] = [];
const nodeTypes = { workflow: WorkflowCanvasNode };
const categoryOrder: EditorCategory[] = [
  "Triggers",
  "Files",
  "AI",
  "Logic",
  "Integrations",
  "Actions",
];
const categoryColor: Record<EditorCategory, string> = {
  Triggers: "#45b97c",
  Files: "#4ba3d9",
  AI: "#d48b45",
  Logic: "#6f8ed8",
  Integrations: "#c96f77",
  Actions: "#b98bd4",
};

const workflowEditorStyles = {
  shell:
    "group/editor grid h-full min-h-0 grid-cols-[236px_minmax(0,1fr)] grid-rows-[54px_minmax(0,1fr)_var(--automation-log-height)] overflow-hidden rounded-lg border border-border bg-background text-foreground max-[1100px]:grid-cols-[210px_minmax(0,1fr)]",
  toolbar:
    "relative z-20 col-[1/-1] grid grid-cols-[minmax(180px,1fr)_auto_minmax(220px,1fr)] items-center gap-3 border-b border-border bg-card py-0 pl-4 pr-3 max-[1100px]:grid-cols-[minmax(150px,1fr)_auto_minmax(190px,1fr)] max-[1100px]:gap-2",
  titleBlock: "flex items-center gap-2",
  name: "h-auto w-[min(360px,34vw)] border-0 bg-transparent px-0 py-1.5 text-[15px] font-semibold shadow-none focus-visible:ring-0",
  saveState: "text-[11px] text-muted-foreground",
  editToolbar: "flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5",
  toolButton:
    "grid size-auto h-[26px] w-7 place-items-center rounded p-0 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35 max-[1100px]:w-[25px]",
  toolButtonActive: "bg-destructive/15 text-destructive",
  toolSeparator: "mx-0.5 h-[17px] w-px bg-border",
  toolbarActions: "flex items-center justify-self-end gap-2",
  button: "h-8 gap-2 rounded-md px-3 text-xs",
  palette: "row-[2/4] min-h-0 overflow-auto border-r border-border bg-card",
  panelHeading:
    "sticky top-0 z-[2] flex h-[42px] items-center justify-between bg-card py-0 pl-3.5 pr-3 text-[11px] font-bold uppercase text-muted-foreground [&>button]:size-7 [&>button]:rounded-md [&>button]:p-0",
  nodeHeading: "top-[42px]",
  workflowList:
    "grid gap-0.5 border-b border-border/60 px-2 pb-2.5 [&_button]:grid [&_button]:h-auto [&_button]:grid-cols-[minmax(0,1fr)_auto] [&_button]:rounded-md [&_button]:bg-transparent [&_button]:p-2 [&_button]:text-left [&_button]:text-muted-foreground [&_button.is-active]:bg-accent [&_button.is-active]:text-foreground [&_button:hover]:bg-accent [&_button:hover]:text-foreground [&_span]:truncate [&_span]:text-xs [&_small]:text-[10px] [&_small]:text-muted-foreground",
  nodeLibrary:
    "px-2 pb-3.5 [&_section]:mb-3 [&_h3]:mx-1.5 [&_h3]:mb-1 [&_h3]:mt-0 [&_h3]:text-[10px] [&_h3]:font-semibold [&_h3]:text-muted-foreground [&_button]:grid [&_button]:h-[34px] [&_button]:w-full [&_button]:grid-cols-[14px_24px_minmax(0,1fr)] [&_button]:cursor-grab [&_button]:select-none [&_button]:rounded-md [&_button]:bg-transparent [&_button]:px-2 [&_button]:py-0 [&_button]:text-left [&_button]:text-xs [&_button]:text-muted-foreground [&_button:hover]:bg-accent [&_button:hover]:text-foreground [&_button:disabled]:opacity-40",
  grip: "text-muted-foreground",
  libraryIcon: "grid place-items-center",
  canvas:
    "relative col-start-2 row-start-2 min-h-0 min-w-0 bg-[color-mix(in_srgb,var(--background)_92%,var(--muted))] [&.is-disconnecting_.react-flow__pane]:cursor-crosshair [&_.react-flow__edge.is-disconnectable_path]:cursor-crosshair [&_.react-flow__edge.is-disconnectable:hover_path]:!stroke-destructive [&_.react-flow__edge.is-disconnectable:hover_path]:![stroke-width:2.6] [&_.react-flow__controls]:overflow-hidden [&_.react-flow__controls]:rounded-md [&_.react-flow__controls]:border [&_.react-flow__controls]:border-border [&_.react-flow__controls]:shadow-sm [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:fill-foreground",
  minimap: "!rounded-md !border !border-border !bg-card !shadow-sm",
  emptyCanvas:
    "pointer-events-none absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-2 text-center text-muted-foreground [&_strong]:text-[13px] [&_strong]:text-foreground [&_span]:text-[11px]",
  log: "relative col-start-2 row-start-3 grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] border-t border-border bg-card",
  logResize:
    "absolute -top-[5px] left-0 z-[4] grid h-[10px] w-full cursor-row-resize place-items-center bg-transparent p-0 [&>span]:h-[3px] [&>span]:w-[38px] [&>span]:rounded-sm [&>span]:bg-border [&>span]:opacity-0 hover:[&>span]:bg-primary hover:[&>span]:opacity-100 group-[.is-resizing-log]/editor:[&>span]:opacity-100",
  logToggle:
    "grid h-[38px] w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 bg-transparent px-3 py-0 text-left text-[11px] text-muted-foreground [&_svg]:transition-transform [&_svg.is-open]:rotate-180",
  logContent: "min-h-0 overflow-auto border-t border-border/60 px-3 py-2",
  logLine: "flex items-center gap-2 p-1 text-[10px] text-muted-foreground",
  logDot: "size-1.5 shrink-0 rounded-full bg-current",
  flowNode:
    "grid min-h-[58px] w-[184px] grid-cols-[38px_minmax(0,1fr)] items-center rounded-lg border border-border border-l-[3px] border-l-[var(--node-color)] bg-card py-2 pl-2 pr-2.5 shadow-sm max-[1100px]:w-[166px] [&.is-selected]:border-[var(--node-color)] [&.is-selected]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--node-color)_24%,transparent)] [&_strong]:block [&_strong]:truncate [&_strong]:text-xs [&_small]:mt-1 [&_small]:block [&_small]:truncate [&_small]:text-[9px] [&_small]:uppercase [&_small]:text-muted-foreground [&_.react-flow__handle]:size-[9px] [&_.react-flow__handle]:border-2 [&_.react-flow__handle]:border-card [&_.react-flow__handle]:bg-[var(--node-color)]",
  flowIcon:
    "grid size-7 place-items-center rounded-md bg-[color-mix(in_srgb,var(--node-color)_15%,var(--muted))] text-[var(--node-color)]",
  nodePopover:
    "absolute right-3 top-3 z-[9] max-h-[calc(100%-24px)] w-[min(300px,calc(100%-24px))] overflow-auto rounded-lg border border-border bg-card px-3.5 pb-4 text-card-foreground shadow-sm",
  settingsPopover: "max-h-[min(520px,calc(100vh-86px))] w-80 overflow-auto p-0",
  inspectorHeading:
    "sticky top-0 z-[2] -mx-3.5 mb-3.5 flex min-h-[58px] items-center justify-between border-b border-border bg-card py-0 pl-3.5 pr-3 [&_span]:block [&_span]:text-[9px] [&_span]:uppercase [&_span]:text-muted-foreground [&_strong]:mt-1 [&_strong]:block [&_strong]:text-[13px] [&_strong]:normal-case [&_strong]:text-foreground [&_button]:size-7 [&_button]:rounded-md [&_button]:p-0",
  inspectorButtons: "!flex",
  field:
    "mb-3.5 grid gap-1.5 [&>span]:text-[11px] [&>span]:font-semibold [&>span]:text-muted-foreground",
  checkbox: "grid-cols-[auto_1fr] items-center",
  inspectorNote: "text-[10px] leading-6 text-muted-foreground",
  safetyNote:
    "rounded-md border border-warning/35 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-muted-foreground",
  dangerButton:
    "h-auto justify-start bg-transparent p-0 text-[11px] text-destructive hover:bg-transparent hover:text-destructive",
} as const;

export function UnifiedWorkflowEditor({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorBody spaceId={spaceId} canManage={canManage} />
    </ReactFlowProvider>
  );
}

function WorkflowEditorBody({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const { user } = useAuth();
  const { screenToFlowPosition, fitView } = useReactFlow<CanvasNode, Edge>();
  const resources = useSpacesStore(
    (state) => state.workflowsBySpace[spaceId] ?? emptyWorkflowResources,
  );
  const loadStudio = useSpacesStore((state) => state.loadStudio);
  const saveStudio = useSpacesStore((state) => state.saveStudio);
  const deleteStudio = useSpacesStore((state) => state.deleteStudio);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<WorkflowDefinitionV2>(() =>
    cloneDefinition(workflowTemplates[0].definition),
  );
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [undoStack, setUndoStack] = useState<WorkflowDefinitionV2[]>([]);
  const [redoStack, setRedoStack] = useState<WorkflowDefinitionV2[]>([]);
  const [clipboard, setClipboard] = useState<WorkflowNodeV2 | null>(null);
  const [disconnectMode, setDisconnectMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [logHeight, setLogHeight] = useState(190);
  const [resizingLog, setResizingLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const canvasRef = useRef<HTMLElement | null>(null);
  const dragSnapshot = useRef<WorkflowDefinitionV2 | null>(null);
  const resizeStart = useRef({ y: 0, height: 190 });

  const selected = resources.find((item) => item.id === selectedId) ?? null;
  const editable = canManage && (!selected || selected.creator_user_id === user?.id);
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId);
  const validationErrors = useMemo(() => validateWorkflowV2(definition), [definition]);
  const palette = useMemo(() => buildPalette(), []);
  const paletteByID = useMemo(() => new Map(palette.map((item) => [item.id, item])), [palette]);
  const nodes = useMemo<CanvasNode[]>(
    () =>
      definition.nodes.map((node) => {
        const descriptor = paletteDescriptorForNode(node, palette);
        return {
          id: node.id,
          type: "workflow",
          position: node.position ?? { x: 0, y: 0 },
          selected: node.id === selectedNodeId,
          draggable: editable,
          data: { workflow: node, descriptor, selected: node.id === selectedNodeId },
        };
      }),
    [definition.nodes, editable, palette, selectedNodeId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      definition.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourcePort,
        targetHandle: edge.targetPort,
        selected: edge.id === selectedEdgeId,
        className: disconnectMode ? "is-disconnectable" : "",
        style: {
          stroke: edge.id === selectedEdgeId ? "var(--primary)" : "#657080",
          strokeWidth: edge.id === selectedEdgeId ? 2.4 : 1.7,
        },
      })),
    [definition.edges, disconnectMode, selectedEdgeId],
  );

  useEffect(() => {
    void loadStudio(spaceId, "workflows");
  }, [loadStudio, spaceId]);
  useEffect(() => {
    if (!selectedId && resources[0]) setSelectedId(resources[0].id);
    if (selectedId && !resources.some((item) => item.id === selectedId))
      setSelectedId(resources[0]?.id ?? "");
  }, [resources, selectedId]);
  useEffect(() => {
    if (!selected) return;
    const next = isV2(selected.definition)
      ? cloneDefinition(selected.definition as unknown as WorkflowDefinitionV2)
      : cloneDefinition(workflowTemplates[0].definition);
    setName(selected.name);
    setDescription(selected.description ?? "");
    setDefinition(next);
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setMessage("");
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    if (!resizingLog) return;
    const move = (event: MouseEvent) =>
      setLogHeight(
        Math.max(
          92,
          Math.min(
            window.innerHeight * 0.62,
            resizeStart.current.height + resizeStart.current.y - event.clientY,
          ),
        ),
      );
    const stop = () => setResizingLog(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [resizingLog]);

  const commit = useCallback(
    (
      next: WorkflowDefinitionV2 | ((current: WorkflowDefinitionV2) => WorkflowDefinitionV2),
      snapshot?: WorkflowDefinitionV2,
    ) => {
      setDefinition((current) => {
        const value = typeof next === "function" ? next(current) : next;
        setUndoStack((items) => [...items.slice(-99), cloneDefinition(snapshot ?? current)]);
        setRedoStack([]);
        setDirty(true);
        return value;
      });
    },
    [],
  );
  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setRedoStack((items) => [...items, cloneDefinition(definition)]);
    setUndoStack((items) => items.slice(0, -1));
    setDefinition(cloneDefinition(previous));
    setDirty(true);
  }, [definition, undoStack]);
  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setUndoStack((items) => [...items, cloneDefinition(definition)]);
    setRedoStack((items) => items.slice(0, -1));
    setDefinition(cloneDefinition(next));
    setDirty(true);
  }, [definition, redoStack]);

  const chooseTemplate = (templateId: string) => {
    const template =
      workflowTemplates.find((item) => item.id === templateId) ?? workflowTemplates[0];
    setSelectedId("");
    setName(template.name);
    setDescription(template.description);
    setDefinition(cloneDefinition(template.definition));
    setSelectedNodeId("");
    setUndoStack([]);
    setRedoStack([]);
    setDirty(true);
    setMessage("Template loaded as a new draft.");
  };
  const addPaletteNode = (item: PaletteDefinition, position: { x: number; y: number }) => {
    if (!editable) return;
    const configured = createConfiguredWorkflowNode(
      item.kind,
      item.label,
      item.config,
      item.capability,
      item.risk,
      position,
    );
    commit((current) => ({
      ...current,
      nodes: [...current.nodes, configured.node],
      capabilities: mergeCapability(
        current.capabilities,
        configured.capability.capability,
        configured.capability.risk,
      ),
    }));
    setSelectedNodeId(configured.node.id);
    setSelectedEdgeId("");
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const item = paletteByID.get(event.dataTransfer.getData("application/x-misty-workflow-node"));
    if (item) addPaletteNode(item, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const next = applyNodeChanges(changes, nodes);
      setDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const canvas = next.find((candidate) => candidate.id === node.id);
          return canvas ? { ...node, position: canvas.position } : node;
        }),
      }));
    },
    [nodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const next = applyEdgeChanges(changes, edges);
      if (next.length === edges.length) return;
      commit((current) => ({ ...current, edges: next.map(flowEdge) }));
    },
    [commit, edges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable || !connection.source || !connection.target) return;
      const next = addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          sourceHandle: connection.sourceHandle ?? "output",
          targetHandle: connection.targetHandle ?? "input",
        },
        edges,
      );
      commit((current) => ({ ...current, edges: next.map(flowEdge) }));
    },
    [commit, editable, edges],
  );
  const removeSelection = useCallback(() => {
    if (!editable || (!selectedNodeId && !selectedEdgeId)) return;
    commit((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedNodeId),
      edges: current.edges.filter(
        (edge) =>
          edge.id !== selectedEdgeId &&
          edge.source !== selectedNodeId &&
          edge.target !== selectedNodeId,
      ),
    }));
    setSelectedNodeId("");
    setSelectedEdgeId("");
  }, [commit, editable, selectedEdgeId, selectedNodeId]);
  const copySelection = useCallback(() => {
    if (selectedNode) setClipboard(cloneNode(selectedNode));
  }, [selectedNode]);
  const paste = useCallback(() => {
    if (!clipboard || !editable) return;
    const copy = cloneNode(clipboard);
    copy.id = `${copy.kind}_${crypto.randomUUID()}`;
    copy.label = `${copy.label} copy`;
    copy.position = {
      x: (clipboard.position?.x ?? 80) + 36,
      y: (clipboard.position?.y ?? 80) + 36,
    };
    commit((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setClipboard(cloneNode(copy));
    setSelectedNodeId(copy.id);
  }, [clipboard, commit, editable]);
  const duplicate = useCallback(() => {
    if (!selectedNode || !editable) return;
    const copy = cloneNode(selectedNode);
    copy.id = `${copy.kind}_${crypto.randomUUID()}`;
    copy.label = `${copy.label} copy`;
    copy.position = {
      x: (selectedNode.position?.x ?? 80) + 36,
      y: (selectedNode.position?.y ?? 80) + 36,
    };
    commit((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setClipboard(cloneNode(copy));
    setSelectedNodeId(copy.id);
  }, [commit, editable, selectedNode]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (modifier && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
      } else if (modifier && event.key.toLowerCase() === "v") {
        event.preventDefault();
        paste();
      } else if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelection();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [copySelection, duplicate, paste, redo, removeSelection, undo]);

  const updateSelected = (patch: Partial<WorkflowNodeV2>) => {
    if (!selectedNodeId) return;
    commit((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNodeId ? { ...node, ...patch } : node,
      ),
    }));
  };
  const save = async () => {
    if (!editable || validationErrors.length || !name.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveStudio(spaceId, "workflows", {
        ...(selected ?? {}),
        id: selected?.id,
        kind: "workflow",
        name: name.trim(),
        description: description.trim(),
        definition: definition as unknown as Record<string, unknown>,
        enabled: true,
        schedules_enabled: false,
        version: selected?.version ?? 0,
      });
      setSelectedId(saved.id);
      setDirty(false);
      setMessage("Draft saved. Publishing creates an immutable version.");
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!selected || !editable || validationErrors.length) return;
    setBusy(true);
    setMessage("");
    try {
      const { versions } = await agentArchitectureApi.workflowVersions(spaceId, selected.id);
      const version = `2.0.${versions.length + 1}`;
      await agentArchitectureApi.createWorkflowVersion(
        spaceId,
        selected.id,
        version,
        workflowMetadata(name, description, definition),
        definition as unknown as Record<string, unknown>,
      );
      await loadStudio(spaceId, "workflows");
      setDirty(false);
      setMessage(`Published immutable workflow ${version}. Attach it to an Agent to run it.`);
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !selected ||
      !editable ||
      !(await confirmAction(
        `Delete ${selected.name}? Published versions and attached Agents prevent unsafe deletion.`,
      ))
    )
      return;
    setBusy(true);
    try {
      await deleteStudio(spaceId, "workflows", selected.id);
      setSelectedId("");
      setMessage("Workflow deleted.");
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const style = { "--automation-log-height": logOpen ? `${logHeight}px` : "38px" } as CSSProperties;
  return (
    <div
      className={`${workflowEditorStyles.shell}${resizingLog ? " is-resizing-log" : ""}`}
      style={style}
    >
      <header className={workflowEditorStyles.toolbar}>
        <div className={workflowEditorStyles.titleBlock}>
          <Input
            className={workflowEditorStyles.name}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
            disabled={!editable}
            placeholder="Untitled workflow"
          />
          <span className={`${workflowEditorStyles.saveState}${dirty ? " text-warning" : ""}`}>
            {dirty ? "Unsaved" : "Saved"}
          </span>
        </div>
        <div className={workflowEditorStyles.editToolbar} aria-label="Edit workflow">
          <ToolButton
            label="Undo"
            disabled={!editable || !undoStack.length}
            onClick={undo}
            icon={Undo2}
          />
          <ToolButton
            label="Redo"
            disabled={!editable || !redoStack.length}
            onClick={redo}
            icon={Redo2}
          />
          <span className={workflowEditorStyles.toolSeparator} />
          <ToolButton
            label="Cut"
            disabled={!editable || !selectedNode}
            onClick={() => {
              copySelection();
              removeSelection();
            }}
            icon={Scissors}
          />
          <ToolButton label="Copy" disabled={!selectedNode} onClick={copySelection} icon={Copy} />
          <ToolButton
            label="Paste"
            disabled={!editable || !clipboard}
            onClick={paste}
            icon={Clipboard}
          />
          <ToolButton
            label="Duplicate"
            disabled={!editable || !selectedNode}
            onClick={duplicate}
            icon={CopyPlus}
          />
          <span className={workflowEditorStyles.toolSeparator} />
          <ToolButton
            label="Delete"
            disabled={!editable || (!selectedNodeId && !selectedEdgeId)}
            onClick={removeSelection}
            icon={Trash2}
          />
          <ToolButton
            label="Disconnect edges"
            active={disconnectMode}
            disabled={!editable}
            onClick={() => setDisconnectMode((value) => !value)}
            icon={Unlink}
          />
          <ToolButton
            label="Fit view"
            onClick={() => void fitView({ padding: 0.22, duration: 180 })}
            icon={Move}
          />
        </div>
        <div className={workflowEditorStyles.toolbarActions}>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                className={workflowEditorStyles.toolButton}
                variant="ghost"
                title="Workflow settings"
                aria-label="Workflow settings"
              >
                <Settings2 size={15} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className={workflowEditorStyles.settingsPopover}
              align="end"
              sideOffset={10}
            >
              <WorkflowSettings
                description={description}
                setDescription={(value) => {
                  setDescription(value);
                  setDirty(true);
                }}
                template={(id) => {
                  chooseTemplate(id);
                  setSettingsOpen(false);
                }}
                remove={selected ? remove : undefined}
              />
            </PopoverContent>
          </Popover>
          <Button
            className={workflowEditorStyles.button}
            variant="secondary"
            disabled={!editable || busy || validationErrors.length > 0 || !name.trim()}
            onClick={() => void save()}
          >
            <Save size={13} />
            Save
          </Button>
          <Button
            className={workflowEditorStyles.button}
            disabled={!selected || !editable || busy || validationErrors.length > 0}
            onClick={() => void publish()}
          >
            <Send size={13} />
            Publish
          </Button>
        </div>
      </header>
      <aside className={workflowEditorStyles.palette}>
        <div className={workflowEditorStyles.panelHeading}>
          <span>Workflows</span>
          <Button
            onClick={() => chooseTemplate(workflowTemplates[0].id)}
            title="New workflow"
            disabled={!canManage}
          >
            <Plus size={14} />
          </Button>
        </div>
        <div className={workflowEditorStyles.workflowList}>
          {resources.map((item) => (
            <Button
              key={item.id}
              className={selected?.id === item.id ? "is-active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>{item.name}</span>
              <small>{item.creator_user_id === user?.id ? "Yours" : "Shared"}</small>
            </Button>
          ))}
        </div>
        <div className={`${workflowEditorStyles.panelHeading} ${workflowEditorStyles.nodeHeading}`}>
          Nodes
        </div>
        <div className={workflowEditorStyles.nodeLibrary}>
          {categoryOrder.map((category) => (
            <section key={category}>
              <h3>{category}</h3>
              {palette
                .filter((item) => item.category === category)
                .map((item) => (
                  <Button
                    key={item.id}
                    disabled={!editable}
                    draggable={editable}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData("application/x-misty-workflow-node", item.id);
                    }}
                    onDoubleClick={() =>
                      addPaletteNode(item, {
                        x: 100 + definition.nodes.length * 24,
                        y: 80 + definition.nodes.length * 20,
                      })
                    }
                    title={item.description}
                  >
                    <GripVertical className={workflowEditorStyles.grip} size={12} />
                    <span
                      className={workflowEditorStyles.libraryIcon}
                      style={{ color: item.color }}
                    >
                      <item.icon size={15} />
                    </span>
                    <span>{item.label}</span>
                  </Button>
                ))}
            </section>
          ))}
        </div>
      </aside>
      <section
        ref={canvasRef}
        className={`${workflowEditorStyles.canvas}${disconnectMode ? " is-disconnecting" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={onDrop}
      >
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId("");
          }}
          onPaneClick={() => {
            setSelectedNodeId("");
            setSelectedEdgeId("");
          }}
          onEdgeClick={(_, edge) => {
            if (disconnectMode && editable) {
              commit((current) => ({
                ...current,
                edges: current.edges.filter((item) => item.id !== edge.id),
              }));
              return;
            }
            setSelectedEdgeId(edge.id);
            setSelectedNodeId("");
          }}
          onNodeDragStart={() => {
            dragSnapshot.current = cloneDefinition(definition);
          }}
          onNodeDragStop={() => {
            if (dragSnapshot.current) {
              setUndoStack((items) => [...items.slice(-99), dragSnapshot.current!]);
              setRedoStack([]);
              setDirty(true);
              dragSnapshot.current = null;
            }
          }}
          nodesConnectable={editable}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls />
          <MiniMap
            className={workflowEditorStyles.minimap}
            pannable
            zoomable
            nodeColor={(node) => (node.data as CanvasData).descriptor.color}
          />
        </ReactFlow>
        {!nodes.length ? (
          <div className={workflowEditorStyles.emptyCanvas}>
            <Workflow size={28} />
            <strong>Build the execution plan</strong>
            <span>Drag a node here from the categorized library.</span>
          </div>
        ) : null}
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            descriptor={paletteDescriptorForNode(selectedNode, palette)}
            editable={editable}
            onChange={updateSelected}
            onClose={() => setSelectedNodeId("")}
            onDelete={removeSelection}
          />
        ) : null}
      </section>
      <section className={workflowEditorStyles.log}>
        <Button
          className={workflowEditorStyles.logResize}
          aria-label="Resize run log"
          onMouseDown={(event) => {
            resizeStart.current = { y: event.clientY, height: logHeight };
            setResizingLog(true);
          }}
        >
          <span />
        </Button>
        <Button
          className={workflowEditorStyles.logToggle}
          onClick={() => setLogOpen((value) => !value)}
        >
          <History size={13} />
          <strong>Run log and validation</strong>
          <ChevronDown size={13} className={logOpen ? "is-open" : ""} />
        </Button>
        {logOpen ? (
          <div className={workflowEditorStyles.logContent}>
            {validationErrors.length ? (
              validationErrors.map((error) => (
                <div className={`${workflowEditorStyles.logLine} text-destructive`} key={error}>
                  <span className={workflowEditorStyles.logDot} />
                  {error}
                </div>
              ))
            ) : (
              <div className={`${workflowEditorStyles.logLine} text-success`}>
                <span className={workflowEditorStyles.logDot} />
                Graph, typed ports, retry policy, and capability envelope are valid.
              </div>
            )}
            {message ? (
              <div className={workflowEditorStyles.logLine}>
                <span className={workflowEditorStyles.logDot} />
                {message}
              </div>
            ) : null}
            <div className={workflowEditorStyles.logLine}>
              <span className={workflowEditorStyles.logDot} />
              {definition.nodes.length} nodes · {definition.edges.length} edges ·{" "}
              {definition.capabilities.length} capabilities
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function WorkflowCanvasNode({ data }: NodeProps<CanvasNode>) {
  const Icon = data.descriptor.icon;
  return (
    <div
      className={`${workflowEditorStyles.flowNode}${data.selected ? " is-selected" : ""}`}
      style={{ "--node-color": data.descriptor.color } as CSSProperties}
    >
      <Handle id="input" type="target" position={Position.Left} />
      <span className={workflowEditorStyles.flowIcon}>
        <Icon size={16} />
      </span>
      <span>
        <strong>{data.workflow.label}</strong>
        <small>
          {data.descriptor.category} · {data.descriptor.risk} · {data.descriptor.location}
        </small>
      </span>
      <Handle id="output" type="source" position={Position.Right} />
    </div>
  );
}

function NodeInspector({
  node,
  descriptor,
  editable,
  onChange,
  onClose,
  onDelete,
}: {
  node: WorkflowNodeV2;
  descriptor: PaletteDefinition;
  editable: boolean;
  onChange: (patch: Partial<WorkflowNodeV2>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const provider = providerById(
    typeof node.config.provider === "string" ? node.config.provider : descriptor.providerId,
  );
  const updateConfig = (key: string, value: unknown) =>
    onChange({ config: { ...node.config, [key]: value } });
  return (
    <aside className={workflowEditorStyles.nodePopover}>
      <header className={workflowEditorStyles.inspectorHeading}>
        <span>
          <span>
            {descriptor.category}
            {provider ? ` · ${provider.name}` : ""}
          </span>
          <strong>{node.label}</strong>
        </span>
        <span className={workflowEditorStyles.inspectorButtons}>
          <Button onClick={onDelete} disabled={!editable} title="Delete node">
            <Trash2 size={13} />
          </Button>
          <Button onClick={onClose} title="Close inspector">
            <X size={14} />
          </Button>
        </span>
      </header>
      <label className={workflowEditorStyles.field}>
        <span>Node name</span>
        <Input
          value={node.label}
          disabled={!editable}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </label>
      {Object.entries(node.config).map(([key, value]) => (
        <ConfigField
          key={key}
          name={key}
          value={value}
          disabled={!editable || key === "provider" || key === "operation"}
          onChange={(next) => updateConfig(key, next)}
        />
      ))}
      <label className={workflowEditorStyles.field}>
        <span>Error behavior</span>
        <Select
          value={node.errors.mode}
          disabled={!editable}
          onValueChange={(value) =>
            onChange({ errors: { ...node.errors, mode: value as "fail" | "continue" | "collect" } })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fail">Stop workflow</SelectItem>
            <SelectItem value="continue">Continue</SelectItem>
            <SelectItem value="collect">Collect item errors</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p className={workflowEditorStyles.inspectorNote}>
        Typed v2 node{" "}
        <code>
          {node.kind}@{node.kindVersion}
        </code>
        . Three total attempts with a 60-second cooldown.
      </p>
      {descriptor.risk !== "read" ? (
        <p className={workflowEditorStyles.safetyNote}>
          This node mutates an external resource. It requires an idempotency journal and the user’s
          exact consent or approval.
        </p>
      ) : null}
    </aside>
  );
}

function ConfigField({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  if (typeof value === "boolean")
    return (
      <label className={`${workflowEditorStyles.field} ${workflowEditorStyles.checkbox}`}>
        <Checkbox
          checked={value}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <span>{label}</span>
      </label>
    );
  if (typeof value === "number")
    return (
      <label className={workflowEditorStyles.field}>
        <span>{label}</span>
        <Input
          type="number"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    );
  if (typeof value === "string")
    return (
      <label className={workflowEditorStyles.field}>
        <span>{label}</span>
        {value.length > 100 || name.toLowerCase().includes("instruction") || name === "body" ? (
          <Textarea
            rows={5}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </label>
    );
  return (
    <label className={workflowEditorStyles.field}>
      <span>{label}</span>
      <Textarea
        rows={5}
        value={JSON.stringify(value, null, 2)}
        disabled={disabled}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            /* preserve last valid typed value */
          }
        }}
      />
    </label>
  );
}

function WorkflowSettings({
  description,
  setDescription,
  template,
  remove,
}: {
  description: string;
  setDescription: (value: string) => void;
  template: (id: string) => void;
  remove?: () => void;
}) {
  return (
    <section className="px-3.5 pb-4">
      <header className={workflowEditorStyles.inspectorHeading}>
        <span>
          <span>Workflow</span>
          <strong>Settings</strong>
        </span>
      </header>
      <label className={workflowEditorStyles.field}>
        <span>Description</span>
        <Textarea
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className={workflowEditorStyles.field}>
        <span>Load template</span>
        <Select onValueChange={template}>
          <SelectTrigger>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {workflowTemplates.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {remove ? (
        <Button
          className={workflowEditorStyles.dangerButton}
          variant="ghost"
          onClick={() => void remove()}
        >
          <Trash2 size={13} />
          Delete workflow
        </Button>
      ) : null}
    </section>
  );
}

function ToolButton({
  label,
  icon: Icon,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={`${workflowEditorStyles.toolButton}${active ? ` ${workflowEditorStyles.toolButtonActive}` : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} />
    </Button>
  );
}

function buildPalette(): PaletteDefinition[] {
  const core = workflowNodeRegistry
    .filter((item) => item.kind !== "exact_tool")
    .map(corePaletteDefinition);
  const providers = providerNodeTemplates.map(providerPaletteDefinition);
  return [...core, ...providers];
}

function corePaletteDefinition(item: WorkflowNodeDescriptor): PaletteDefinition {
  const category = coreCategory(item);
  return {
    id: `core.${item.kind}`,
    kind: item.kind,
    label: item.label,
    category,
    color: categoryColor[category],
    icon: coreIcon(item.kind),
    capability: item.capability,
    risk: item.risk,
    location: item.location,
    config: structuredClone(item.defaultConfig),
    description: `${item.label} (${item.risk}, ${item.location}).`,
  };
}

function providerPaletteDefinition(item: ProviderNodeTemplate): PaletteDefinition {
  const provider = providerById(item.providerId)!;
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    category: item.category,
    color: provider.color,
    icon:
      item.category === "Triggers" ? CirclePlay : item.category === "Actions" ? FileOutput : Globe2,
    capability: item.capability,
    risk: item.risk,
    location: "cloud",
    providerId: item.providerId,
    description: item.description,
    config: {
      provider: item.providerId,
      operation: item.operation,
      ...structuredClone(item.defaults ?? {}),
    },
  };
}

function paletteDescriptorForNode(
  node: WorkflowNodeV2,
  palette: PaletteDefinition[],
): PaletteDefinition {
  const provider = typeof node.config.provider === "string" ? node.config.provider : undefined;
  const operation = typeof node.config.operation === "string" ? node.config.operation : undefined;
  return (
    palette.find(
      (item) =>
        item.providerId === provider &&
        item.config.operation === operation &&
        item.kind === node.kind,
    ) ??
    palette.find((item) => !item.providerId && item.kind === node.kind) ??
    corePaletteDefinition(workflowNodeRegistry[0])
  );
}

function coreCategory(item: WorkflowNodeDescriptor): EditorCategory {
  if (item.group === "Triggers") return "Triggers";
  if (item.group === "Data") return "Files";
  if (item.group === "Control") return "Logic";
  if (item.group === "Intelligence") return "AI";
  return item.kind === "http_request" ? "Integrations" : "Actions";
}

function coreIcon(kind: WorkflowNodeKind): LucideIcon {
  if (kind.includes("trigger") || kind === "file_changes" || kind === "library_changes")
    return CirclePlay;
  if (kind === "changed_files") return FolderOpen;
  if (kind === "source_query") return Filter;
  if (kind === "read_content") return FileInput;
  if (kind === "read_metadata") return HardDrive;
  if (kind === "agent_task") return Sparkles;
  if (
    [
      "for_each",
      "condition",
      "switch",
      "join",
      "debounce",
      "delay",
      "call_workflow",
      "transform",
    ].includes(kind)
  )
    return ListTree;
  if (kind === "notify_private") return MessageSquare;
  if (kind === "http_request") return Globe2;
  if (kind === "memory_write") return Bot;
  return FileOutput;
}

function flowEdge(edge: Edge) {
  return {
    id: edge.id,
    source: edge.source,
    sourcePort: edge.sourceHandle ?? "output",
    target: edge.target,
    targetPort: edge.targetHandle ?? "input",
  };
}
function cloneDefinition(value: WorkflowDefinitionV2): WorkflowDefinitionV2 {
  return structuredClone(value);
}
function cloneNode(value: WorkflowNodeV2): WorkflowNodeV2 {
  return structuredClone(value);
}
function isV2(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && value.formatVersion === 2 && Array.isArray(value.nodes));
}
function mergeCapability(
  items: WorkflowDefinitionV2["capabilities"],
  capability: string,
  risk: "read" | "write" | "destructive",
) {
  const rank = { read: 1, write: 2, destructive: 3 } as const;
  const existing = items.find((item) => item.capability === capability);
  if (!existing) return [...items, { capability, risk }];
  return items.map((item) =>
    item.capability === capability && rank[risk] > rank[item.risk] ? { ...item, risk } : item,
  );
}
function workflowMetadata(
  name: string,
  description: string,
  definition: WorkflowDefinitionV2,
): WorkflowMetadata {
  const destructive = definition.capabilities.some((item) => item.risk === "destructive");
  const writes = definition.capabilities.some((item) => item.risk === "write");
  const id =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "workflow";
  const requiredIntegrations = [
    ...new Set(
      definition.nodes
        .map((node) => (typeof node.config.provider === "string" ? node.config.provider : ""))
        .filter(Boolean),
    ),
  ];
  return {
    capabilities: [
      {
        id,
        name: name.trim(),
        description: description.trim() || `Run ${name.trim()}`,
        inputs: [{ name: "prompt", type: "string", required: false }],
        outputs: [{ name: "result", type: "object" }],
        readOnly: !writes && !destructive,
        destructive,
        confirmationRequired: destructive,
        tags: definition.capabilities.map((item) => item.capability),
      },
    ],
    requiredIntegrations,
    requiredPermissions: definition.capabilities
      .map((item) => item.capability)
      .filter((item) => item === "files.read" || item === "files.write"),
    runtime: { kind: "misty-cloud", compatibility: "workflow-v2" },
    tags: ["workflow-v2"],
  };
}
