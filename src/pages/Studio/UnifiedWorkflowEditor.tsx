import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
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
  Bot, Check, ChevronDown, CirclePlay, Clipboard, Copy, CopyPlus, FileInput, FileOutput,
  Filter, FolderOpen, Globe2, GripVertical, HardDrive, History, ListTree, MessageSquare,
  Move, Plus, Redo2, Save, Scissors, Send, Settings2, Sparkles, Trash2, Undo2, Unlink,
  Workflow, X, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { errorText } from "../../shared/format";
import { confirmAction } from "../../shared/confirmAction";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type { SpaceStudioResource, WorkflowMetadata } from "../../spaces/types";
import { useSpacesStore } from "../../stores/useSpacesStore";
import { workflowTemplates } from "../../workflows/templates";
import { providerById, providerNodeTemplates, type ProviderNodeTemplate } from "../../workflows/providers";
import {
  createConfiguredWorkflowNode, createWorkflowNode, validateWorkflowV2, workflowNodeRegistry,
  type WorkflowDefinitionV2, type WorkflowNodeDescriptor, type WorkflowNodeKind, type WorkflowNodeV2,
} from "../../workflows/v2";
import "./unifiedWorkflowEditor.css";

type CanvasData = { workflow: WorkflowNodeV2; descriptor: PaletteDefinition; selected: boolean };
type CanvasNode = Node<CanvasData, "workflow">;
type PaletteDefinition = {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  category: EditorCategory;
  color: string;
  icon: LucideIcon;
  capability: string;
  risk: "read" | "write" | "destructive";
  location: "cloud" | "device" | "either";
  config: Record<string, unknown>;
  providerId?: string;
  description: string;
};
type EditorCategory = "Triggers" | "Files" | "AI" | "Logic" | "Integrations" | "Actions";

const emptyWorkflowResources: SpaceStudioResource[] = [];
const nodeTypes = { workflow: WorkflowCanvasNode };
const categoryOrder: EditorCategory[] = ["Triggers", "Files", "AI", "Logic", "Integrations", "Actions"];
const categoryColor: Record<EditorCategory, string> = {
  Triggers: "#45b97c", Files: "#4ba3d9", AI: "#d48b45", Logic: "#6f8ed8", Integrations: "#c96f77", Actions: "#b98bd4",
};

export function UnifiedWorkflowEditor({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  return <ReactFlowProvider><WorkflowEditorBody spaceId={spaceId} canManage={canManage} /></ReactFlowProvider>;
}

function WorkflowEditorBody({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const { user } = useAuth();
  const { screenToFlowPosition, fitView } = useReactFlow<CanvasNode, Edge>();
  const resources = useSpacesStore((state) => state.workflowsBySpace[spaceId] ?? emptyWorkflowResources);
  const loadStudio = useSpacesStore((state) => state.loadStudio);
  const saveStudio = useSpacesStore((state) => state.saveStudio);
  const deleteStudio = useSpacesStore((state) => state.deleteStudio);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<WorkflowDefinitionV2>(() => cloneDefinition(workflowTemplates[0].definition));
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
  const nodes = useMemo<CanvasNode[]>(() => definition.nodes.map((node) => {
    const descriptor = paletteDescriptorForNode(node, palette);
    return { id: node.id, type: "workflow", position: node.position ?? { x: 0, y: 0 }, selected: node.id === selectedNodeId, draggable: editable, data: { workflow: node, descriptor, selected: node.id === selectedNodeId } };
  }), [definition.nodes, editable, palette, selectedNodeId]);
  const edges = useMemo<Edge[]>(() => definition.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort,
    selected: edge.id === selectedEdgeId, className: disconnectMode ? "is-disconnectable" : "",
    style: { stroke: edge.id === selectedEdgeId ? "var(--misty-accent)" : "#657080", strokeWidth: edge.id === selectedEdgeId ? 2.4 : 1.7 },
  })), [definition.edges, disconnectMode, selectedEdgeId]);

  useEffect(() => { void loadStudio(spaceId, "workflows"); }, [loadStudio, spaceId]);
  useEffect(() => {
    if (!selectedId && resources[0]) setSelectedId(resources[0].id);
    if (selectedId && !resources.some((item) => item.id === selectedId)) setSelectedId(resources[0]?.id ?? "");
  }, [resources, selectedId]);
  useEffect(() => {
    if (!selected) return;
    const next = isV2(selected.definition) ? cloneDefinition(selected.definition as unknown as WorkflowDefinitionV2) : cloneDefinition(workflowTemplates[0].definition);
    setName(selected.name); setDescription(selected.description ?? ""); setDefinition(next);
    setSelectedNodeId(""); setSelectedEdgeId(""); setUndoStack([]); setRedoStack([]); setDirty(false); setMessage("");
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    if (!resizingLog) return;
    const move = (event: MouseEvent) => setLogHeight(Math.max(92, Math.min(window.innerHeight * .62, resizeStart.current.height + resizeStart.current.y - event.clientY)));
    const stop = () => setResizingLog(false);
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", stop); window.addEventListener("blur", stop);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); window.removeEventListener("blur", stop); };
  }, [resizingLog]);

  const commit = useCallback((next: WorkflowDefinitionV2 | ((current: WorkflowDefinitionV2) => WorkflowDefinitionV2), snapshot?: WorkflowDefinitionV2) => {
    setDefinition((current) => {
      const value = typeof next === "function" ? next(current) : next;
      setUndoStack((items) => [...items.slice(-99), cloneDefinition(snapshot ?? current)]);
      setRedoStack([]); setDirty(true);
      return value;
    });
  }, []);
  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1]; if (!previous) return;
    setRedoStack((items) => [...items, cloneDefinition(definition)]); setUndoStack((items) => items.slice(0, -1)); setDefinition(cloneDefinition(previous)); setDirty(true);
  }, [definition, undoStack]);
  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1]; if (!next) return;
    setUndoStack((items) => [...items, cloneDefinition(definition)]); setRedoStack((items) => items.slice(0, -1)); setDefinition(cloneDefinition(next)); setDirty(true);
  }, [definition, redoStack]);

  const chooseTemplate = (templateId: string) => {
    const template = workflowTemplates.find((item) => item.id === templateId) ?? workflowTemplates[0];
    setSelectedId(""); setName(template.name); setDescription(template.description); setDefinition(cloneDefinition(template.definition));
    setSelectedNodeId(""); setUndoStack([]); setRedoStack([]); setDirty(true); setMessage("Template loaded as a new draft.");
  };
  const addPaletteNode = (item: PaletteDefinition, position: { x: number; y: number }) => {
    if (!editable) return;
    const configured = createConfiguredWorkflowNode(item.kind, item.label, item.config, item.capability, item.risk, position);
    commit((current) => ({ ...current, nodes: [...current.nodes, configured.node], capabilities: mergeCapability(current.capabilities, configured.capability.capability, configured.capability.risk) }));
    setSelectedNodeId(configured.node.id); setSelectedEdgeId("");
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const item = paletteByID.get(event.dataTransfer.getData("application/x-misty-workflow-node"));
    if (item) addPaletteNode(item, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const next = applyNodeChanges(changes, nodes);
    setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => {
      const canvas = next.find((candidate) => candidate.id === node.id);
      return canvas ? { ...node, position: canvas.position } : node;
    }) }));
  }, [nodes]);
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const next = applyEdgeChanges(changes, edges);
    if (next.length === edges.length) return;
    commit((current) => ({ ...current, edges: next.map(flowEdge) }));
  }, [commit, edges]);
  const onConnect = useCallback((connection: Connection) => {
    if (!editable || !connection.source || !connection.target) return;
    const next = addEdge({ ...connection, id: crypto.randomUUID(), sourceHandle: connection.sourceHandle ?? "output", targetHandle: connection.targetHandle ?? "input" }, edges);
    commit((current) => ({ ...current, edges: next.map(flowEdge) }));
  }, [commit, editable, edges]);
  const removeSelection = useCallback(() => {
    if (!editable || !selectedNodeId && !selectedEdgeId) return;
    commit((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selectedNodeId), edges: current.edges.filter((edge) => edge.id !== selectedEdgeId && edge.source !== selectedNodeId && edge.target !== selectedNodeId) }));
    setSelectedNodeId(""); setSelectedEdgeId("");
  }, [commit, editable, selectedEdgeId, selectedNodeId]);
  const copySelection = useCallback(() => { if (selectedNode) setClipboard(cloneNode(selectedNode)); }, [selectedNode]);
  const paste = useCallback(() => {
    if (!clipboard || !editable) return;
    const copy = cloneNode(clipboard); copy.id = `${copy.kind}_${crypto.randomUUID()}`; copy.label = `${copy.label} copy`;
    copy.position = { x: (clipboard.position?.x ?? 80) + 36, y: (clipboard.position?.y ?? 80) + 36 };
    commit((current) => ({ ...current, nodes: [...current.nodes, copy] })); setClipboard(cloneNode(copy)); setSelectedNodeId(copy.id);
  }, [clipboard, commit, editable]);
  const duplicate = useCallback(() => {
    if (!selectedNode || !editable) return;
    const copy = cloneNode(selectedNode); copy.id = `${copy.kind}_${crypto.randomUUID()}`; copy.label = `${copy.label} copy`;
    copy.position = { x: (selectedNode.position?.x ?? 80) + 36, y: (selectedNode.position?.y ?? 80) + 36 };
    commit((current) => ({ ...current, nodes: [...current.nodes, copy] })); setClipboard(cloneNode(copy)); setSelectedNodeId(copy.id);
  }, [commit, editable, selectedNode]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (modifier && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
      else if (modifier && event.key.toLowerCase() === "v") { event.preventDefault(); paste(); }
      else if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelection(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [copySelection, duplicate, paste, redo, removeSelection, undo]);

  const updateSelected = (patch: Partial<WorkflowNodeV2>) => {
    if (!selectedNodeId) return;
    commit((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node) }));
  };
  const save = async () => {
    if (!editable || validationErrors.length || !name.trim()) return;
    setBusy(true); setMessage("");
    try {
      const saved = await saveStudio(spaceId, "workflows", { ...(selected ?? {}), id: selected?.id, kind: "workflow", name: name.trim(), description: description.trim(), definition: definition as unknown as Record<string, unknown>, enabled: true, schedules_enabled: false, version: selected?.version ?? 0 });
      setSelectedId(saved.id); setDirty(false); setMessage("Draft saved. Publishing creates an immutable version.");
    } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!selected || !editable || validationErrors.length) return;
    setBusy(true); setMessage("");
    try {
      const { versions } = await agentArchitectureApi.workflowVersions(spaceId, selected.id);
      const version = `2.0.${versions.length + 1}`;
      await agentArchitectureApi.createWorkflowVersion(spaceId, selected.id, version, workflowMetadata(name, description, definition), definition as unknown as Record<string, unknown>);
      await loadStudio(spaceId, "workflows"); setDirty(false); setMessage(`Published immutable workflow ${version}. Attach it to an Agent to run it.`);
    } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || !editable || !await confirmAction(`Delete ${selected.name}? Published versions and attached Agents prevent unsafe deletion.`)) return;
    setBusy(true); try { await deleteStudio(spaceId, "workflows", selected.id); setSelectedId(""); setMessage("Workflow deleted."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); }
  };

  const style = { "--automation-log-height": logOpen ? `${logHeight}px` : "38px" } as CSSProperties;
  return <div className={`automation-shell${resizingLog ? " is-resizing-log" : ""}`} style={style}>
    <header className="automation-toolbar">
      <div className="automation-title-block"><input className="automation-name" value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} disabled={!editable} placeholder="Untitled workflow"/><span className={`automation-save-state${dirty ? " is-dirty" : ""}`}>{dirty ? "Unsaved" : "Saved"}</span></div>
      <div className="automation-edit-toolbar" aria-label="Edit workflow">
        <ToolButton label="Undo" disabled={!editable || !undoStack.length} onClick={undo} icon={Undo2}/><ToolButton label="Redo" disabled={!editable || !redoStack.length} onClick={redo} icon={Redo2}/><span className="automation-tool-separator"/>
        <ToolButton label="Cut" disabled={!editable || !selectedNode} onClick={() => { copySelection(); removeSelection(); }} icon={Scissors}/><ToolButton label="Copy" disabled={!selectedNode} onClick={copySelection} icon={Copy}/><ToolButton label="Paste" disabled={!editable || !clipboard} onClick={paste} icon={Clipboard}/><ToolButton label="Duplicate" disabled={!editable || !selectedNode} onClick={duplicate} icon={CopyPlus}/><span className="automation-tool-separator"/>
        <ToolButton label="Delete" disabled={!editable || !selectedNodeId && !selectedEdgeId} onClick={removeSelection} icon={Trash2}/><ToolButton label="Disconnect edges" active={disconnectMode} disabled={!editable} onClick={() => setDisconnectMode((value) => !value)} icon={Unlink}/><ToolButton label="Fit view" onClick={() => void fitView({ padding: .22, duration: 180 })} icon={Move}/>
      </div>
      <div className="automation-toolbar-actions"><div className="automation-workflow-settings-anchor"><button className="automation-tool-button" title="Workflow settings" onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={15}/></button>{settingsOpen ? <WorkflowSettings description={description} setDescription={(value) => { setDescription(value); setDirty(true); }} template={(id) => { chooseTemplate(id); setSettingsOpen(false); }} remove={selected ? remove : undefined}/> : null}</div><button className="automation-button" disabled={!editable || busy || validationErrors.length > 0 || !name.trim()} onClick={() => void save()}><Save size={13}/>Save</button><button className="automation-button automation-button-primary" disabled={!selected || !editable || busy || validationErrors.length > 0} onClick={() => void publish()}><Send size={13}/>Publish</button></div>
    </header>
    <aside className="automation-palette">
      <div className="automation-panel-heading"><span>Workflows</span><button onClick={() => chooseTemplate(workflowTemplates[0].id)} title="New workflow" disabled={!canManage}><Plus size={14}/></button></div>
      <div className="automation-workflow-list">{resources.map((item) => <button key={item.id} className={selected?.id === item.id ? "is-active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.name}</span><small>{item.creator_user_id === user?.id ? "Yours" : "Shared"}</small></button>)}</div>
      <div className="automation-panel-heading automation-node-heading">Nodes</div>
      <div className="automation-node-library">{categoryOrder.map((category) => <section key={category}><h3>{category}</h3>{palette.filter((item) => item.category === category).map((item) => <button key={item.id} disabled={!editable} draggable={editable} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-misty-workflow-node", item.id); }} onDoubleClick={() => addPaletteNode(item, { x: 100 + definition.nodes.length * 24, y: 80 + definition.nodes.length * 20 })} title={item.description}><GripVertical className="automation-grip" size={12}/><span className="automation-library-icon" style={{ color: item.color }}><item.icon size={15}/></span><span>{item.label}</span></button>)}</section>)}</div>
    </aside>
    <section ref={canvasRef} className={`automation-canvas${disconnectMode ? " is-disconnecting" : ""}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onDrop}>
      <ReactFlow<CanvasNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(""); }} onPaneClick={() => { setSelectedNodeId(""); setSelectedEdgeId(""); }} onEdgeClick={(_, edge) => { if (disconnectMode && editable) { commit((current) => ({ ...current, edges: current.edges.filter((item) => item.id !== edge.id) })); return; } setSelectedEdgeId(edge.id); setSelectedNodeId(""); }} onNodeDragStart={() => { dragSnapshot.current = cloneDefinition(definition); }} onNodeDragStop={() => { if (dragSnapshot.current) { setUndoStack((items) => [...items.slice(-99), dragSnapshot.current!]); setRedoStack([]); setDirty(true); dragSnapshot.current = null; } }} nodesConnectable={editable} fitView minZoom={.2} maxZoom={1.8} deleteKeyCode={null}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1}/><Controls/><MiniMap className="automation-minimap" pannable zoomable nodeColor={(node) => (node.data as CanvasData).descriptor.color}/>
      </ReactFlow>
      {!nodes.length ? <div className="automation-empty-canvas"><Workflow size={28}/><strong>Build the execution plan</strong><span>Drag a node here from the categorized library.</span></div> : null}
      {selectedNode ? <NodeInspector node={selectedNode} descriptor={paletteDescriptorForNode(selectedNode, palette)} editable={editable} onChange={updateSelected} onClose={() => setSelectedNodeId("")} onDelete={removeSelection}/> : null}
    </section>
    <section className="automation-log">
      <button className="automation-log-resize" aria-label="Resize run log" onMouseDown={(event) => { resizeStart.current = { y: event.clientY, height: logHeight }; setResizingLog(true); }}><span/></button>
      <button className="automation-log-toggle" onClick={() => setLogOpen((value) => !value)}><History size={13}/><strong>Run log and validation</strong><ChevronDown size={13} className={logOpen ? "is-open" : ""}/></button>
      {logOpen ? <div className="automation-log-content">{validationErrors.length ? validationErrors.map((error) => <div className="automation-log-line is-error" key={error}><span className="automation-log-dot"/>{error}</div>) : <div className="automation-log-line is-success"><span className="automation-log-dot"/>Graph, typed ports, retry policy, and capability envelope are valid.</div>}{message ? <div className="automation-log-line"><span className="automation-log-dot"/>{message}</div> : null}<div className="automation-log-line"><span className="automation-log-dot"/>{definition.nodes.length} nodes · {definition.edges.length} edges · {definition.capabilities.length} capabilities</div></div> : null}
    </section>
  </div>;
}

function WorkflowCanvasNode({ data }: NodeProps<CanvasNode>) {
  const Icon = data.descriptor.icon;
  return <div className={`automation-flow-node${data.selected ? " is-selected" : ""}`} style={{ "--node-color": data.descriptor.color } as CSSProperties}><Handle id="input" type="target" position={Position.Left}/><span className="automation-flow-icon"><Icon size={16}/></span><span><strong>{data.workflow.label}</strong><small>{data.descriptor.category} · {data.descriptor.risk} · {data.descriptor.location}</small></span><Handle id="output" type="source" position={Position.Right}/></div>;
}

function NodeInspector({ node, descriptor, editable, onChange, onClose, onDelete }: { node: WorkflowNodeV2; descriptor: PaletteDefinition; editable: boolean; onChange: (patch: Partial<WorkflowNodeV2>) => void; onClose: () => void; onDelete: () => void }) {
  const provider = providerById(typeof node.config.provider === "string" ? node.config.provider : descriptor.providerId);
  const updateConfig = (key: string, value: unknown) => onChange({ config: { ...node.config, [key]: value } });
  return <aside className="automation-node-popover">
    <header className="automation-inspector-heading"><span><span>{descriptor.category}{provider ? ` · ${provider.name}` : ""}</span><strong>{node.label}</strong></span><span className="automation-inspector-buttons"><button onClick={onDelete} disabled={!editable} title="Delete node"><Trash2 size={13}/></button><button onClick={onClose} title="Close inspector"><X size={14}/></button></span></header>
    <label className="automation-field"><span>Node name</span><input value={node.label} disabled={!editable} onChange={(event) => onChange({ label: event.target.value })}/></label>
    {Object.entries(node.config).map(([key, value]) => <ConfigField key={key} name={key} value={value} disabled={!editable || key === "provider" || key === "operation"} onChange={(next) => updateConfig(key, next)}/>) }
    <label className="automation-field"><span>Error behavior</span><select value={node.errors.mode} disabled={!editable} onChange={(event) => onChange({ errors: { ...node.errors, mode: event.target.value as "fail" | "continue" | "collect" } })}><option value="fail">Stop workflow</option><option value="continue">Continue</option><option value="collect">Collect item errors</option></select></label>
    <p className="automation-inspector-note">Typed v2 node <code>{node.kind}@{node.kindVersion}</code>. Three total attempts with a 60-second cooldown.</p>
    {descriptor.risk !== "read" ? <p className="automation-safety-note">This node mutates an external resource. It requires an idempotency journal and the user’s exact consent or approval.</p> : null}
  </aside>;
}

function ConfigField({ name, value, disabled, onChange }: { name: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const label = name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  if (typeof value === "boolean") return <label className="automation-field automation-checkbox"><input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/><span>{label}</span></label>;
  if (typeof value === "number") return <label className="automation-field"><span>{label}</span><input type="number" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}/></label>;
  if (typeof value === "string") return <label className="automation-field"><span>{label}</span>{value.length > 100 || name.toLowerCase().includes("instruction") || name === "body" ? <textarea rows={5} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}/> : <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}/>}</label>;
  return <label className="automation-field"><span>{label}</span><textarea rows={5} value={JSON.stringify(value, null, 2)} disabled={disabled} onChange={(event) => { try { onChange(JSON.parse(event.target.value)); } catch { /* preserve last valid typed value */ } }}/></label>;
}

function WorkflowSettings({ description, setDescription, template, remove }: { description: string; setDescription: (value: string) => void; template: (id: string) => void; remove?: () => void }) {
  return <section className="automation-workflow-settings-popover"><header className="automation-inspector-heading"><span><span>Workflow</span><strong>Settings</strong></span></header><label className="automation-field"><span>Description</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)}/></label><label className="automation-field"><span>Load template</span><select defaultValue="" onChange={(event) => event.target.value && template(event.target.value)}><option value="">Choose…</option>{workflowTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{remove ? <button className="automation-danger-button" onClick={() => void remove()}><Trash2 size={13}/>Delete workflow</button> : null}</section>;
}

function ToolButton({ label, icon: Icon, disabled, active, onClick }: { label: string; icon: LucideIcon; disabled?: boolean; active?: boolean; onClick: () => void }) {
  return <button className={`automation-tool-button${active ? " is-active" : ""}`} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon size={14}/></button>;
}

function buildPalette(): PaletteDefinition[] {
  const core = workflowNodeRegistry.filter((item) => item.kind !== "exact_tool").map(corePaletteDefinition);
  const providers = providerNodeTemplates.map(providerPaletteDefinition);
  return [...core, ...providers];
}

function corePaletteDefinition(item: WorkflowNodeDescriptor): PaletteDefinition {
  const category = coreCategory(item);
  return { id: `core.${item.kind}`, kind: item.kind, label: item.label, category, color: categoryColor[category], icon: coreIcon(item.kind), capability: item.capability, risk: item.risk, location: item.location, config: structuredClone(item.defaultConfig), description: `${item.label} (${item.risk}, ${item.location}).` };
}

function providerPaletteDefinition(item: ProviderNodeTemplate): PaletteDefinition {
  const provider = providerById(item.providerId)!;
  return { id: item.id, kind: item.kind, label: item.label, category: item.category, color: provider.color, icon: item.category === "Triggers" ? CirclePlay : item.category === "Actions" ? FileOutput : Globe2, capability: item.capability, risk: item.risk, location: "cloud", providerId: item.providerId, description: item.description, config: { provider: item.providerId, operation: item.operation, ...structuredClone(item.defaults ?? {}) } };
}

function paletteDescriptorForNode(node: WorkflowNodeV2, palette: PaletteDefinition[]): PaletteDefinition {
  const provider = typeof node.config.provider === "string" ? node.config.provider : undefined;
  const operation = typeof node.config.operation === "string" ? node.config.operation : undefined;
  return palette.find((item) => item.providerId === provider && item.config.operation === operation && item.kind === node.kind) ?? palette.find((item) => !item.providerId && item.kind === node.kind) ?? corePaletteDefinition(workflowNodeRegistry[0]);
}

function coreCategory(item: WorkflowNodeDescriptor): EditorCategory {
  if (item.group === "Triggers") return "Triggers";
  if (item.group === "Data") return "Files";
  if (item.group === "Control") return "Logic";
  if (item.group === "Intelligence") return "AI";
  return item.kind === "http_request" ? "Integrations" : "Actions";
}

function coreIcon(kind: WorkflowNodeKind): LucideIcon {
  if (kind.includes("trigger") || kind === "file_changes" || kind === "library_changes") return CirclePlay;
  if (kind === "changed_files") return FolderOpen;
  if (kind === "source_query") return Filter;
  if (kind === "read_content") return FileInput;
  if (kind === "read_metadata") return HardDrive;
  if (kind === "agent_task") return Sparkles;
  if (["for_each", "condition", "switch", "join", "debounce", "delay", "call_workflow", "transform"].includes(kind)) return ListTree;
  if (kind === "notify_private") return MessageSquare;
  if (kind === "http_request") return Globe2;
  if (kind === "memory_write") return Bot;
  return FileOutput;
}

function flowEdge(edge: Edge) { return { id: edge.id, source: edge.source, sourcePort: edge.sourceHandle ?? "output", target: edge.target, targetPort: edge.targetHandle ?? "input" }; }
function cloneDefinition(value: WorkflowDefinitionV2): WorkflowDefinitionV2 { return structuredClone(value); }
function cloneNode(value: WorkflowNodeV2): WorkflowNodeV2 { return structuredClone(value); }
function isV2(value: Record<string, unknown> | undefined): boolean { return Boolean(value && value.formatVersion === 2 && Array.isArray(value.nodes)); }
function mergeCapability(items: WorkflowDefinitionV2["capabilities"], capability: string, risk: "read" | "write" | "destructive") {
  const rank = { read: 1, write: 2, destructive: 3 } as const;
  const existing = items.find((item) => item.capability === capability);
  if (!existing) return [...items, { capability, risk }];
  return items.map((item) => item.capability === capability && rank[risk] > rank[item.risk] ? { ...item, risk } : item);
}
function workflowMetadata(name: string, description: string, definition: WorkflowDefinitionV2): WorkflowMetadata {
  const destructive = definition.capabilities.some((item) => item.risk === "destructive");
  const writes = definition.capabilities.some((item) => item.risk === "write");
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "workflow";
  const requiredIntegrations = [...new Set(definition.nodes.map((node) => typeof node.config.provider === "string" ? node.config.provider : "").filter(Boolean))];
  return { capabilities: [{ id, name: name.trim(), description: description.trim() || `Run ${name.trim()}`, inputs: [{ name: "prompt", type: "string", required: false }], outputs: [{ name: "result", type: "object" }], readOnly: !writes && !destructive, destructive, confirmationRequired: destructive, tags: definition.capabilities.map((item) => item.capability) }], requiredIntegrations, requiredPermissions: definition.capabilities.map((item) => item.capability).filter((item) => item === "files.read" || item === "files.write"), runtime: { kind: "misty-cloud", compatibility: "workflow-v2" }, tags: ["workflow-v2"] };
}
