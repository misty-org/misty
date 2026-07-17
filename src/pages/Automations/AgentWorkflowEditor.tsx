import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, Bot, FileDown, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { AgentActionKind, AgentDefinition, AgentWorkflowNode, AgentWorkflowNodeKind } from "../../agents/types";
import { useAgentsStore } from "../../stores/useAgentsStore";
import { MistyFilePicker } from "../../components/MistyFilePicker/MistyFilePicker";
import { workflowsReadMf, workflowsWriteMf } from "../../api/misty";
import { agentDefinitionToMf, mfToAgentWorkflow, validateMfWorkflow } from "../../workflows/mf";

type AgentCanvasData = { label: string; kind: AgentWorkflowNodeKind };
type AgentCanvasNode = Node<AgentCanvasData, "agent-workflow">;

const palette: Array<{ kind: AgentWorkflowNodeKind; label: string; action?: AgentActionKind; mode?: "automatic" | "approval"; available?: boolean }> = [
  { kind: "manual_trigger", label: "Manual trigger" },
  { kind: "schedule_trigger", label: "Schedule trigger" },
  { kind: "file_event", label: "File event" },
  { kind: "local_webhook", label: "Local webhook", available: false },
  { kind: "folder_query", label: "Search folder", action: "search", mode: "automatic" },
  { kind: "document_read", label: "Read document", action: "read", mode: "automatic" },
  { kind: "document_ocr", label: "OCR document", action: "read", mode: "automatic" },
  { kind: "mika_task", label: "Ask Mika", action: "summarize", mode: "automatic" },
  { kind: "artifact_create", label: "Create artifact", action: "create_file", mode: "automatic" },
  { kind: "approval", label: "Approval" },
  { kind: "reply", label: "Reply" },
];

const labelByKind = new Map(palette.map((item) => [item.kind, item.label]));
const nodeTypes = { "agent-workflow": AgentWorkflowCanvasNode };

export function AgentWorkflowEditor({ agentId, spaceId, personalSpaceId }: { agentId: string; spaceId?: string; personalSpaceId?: string }) {
  const snapshot = useAgentsStore((state) => state.snapshot);
  const loading = useAgentsStore((state) => state.loading);
  const saving = useAgentsStore((state) => state.saving);
  const load = useAgentsStore((state) => state.load);
  const saveDefinition = useAgentsStore((state) => state.saveDefinition);
  const definition = snapshot.definitions.find((item) => item.id === agentId && (!spaceId || item.spaceId === spaceId)) ?? null;
  const [draft, setDraft] = useState<AgentDefinition | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mfPickerOpen, setMfPickerOpen] = useState(false);

  useEffect(() => { void load(personalSpaceId); }, [load, personalSpaceId]);
  useEffect(() => { if (definition) setDraft(definition); }, [definition?.id, definition?.version]);

  const nodes = useMemo<AgentCanvasNode[]>(() => (draft?.workflow.nodes ?? []).map((node, index) => ({
    id: node.id,
    type: "agent-workflow",
    position: editorPosition(node, index),
    selected: node.id === selectedNodeId,
    data: { label: labelByKind.get(node.kind) ?? node.kind, kind: node.kind },
  })), [draft?.workflow.nodes, selectedNodeId]);
  const edges = useMemo<Edge[]>(() => (draft?.workflow.edges ?? []).map((edge, index) => ({
    id: `${edge.from}:${edge.to}:${index}`,
    source: edge.from,
    target: edge.to,
  })), [draft?.workflow.edges]);

  const onNodesChange = useCallback((changes: NodeChange<AgentCanvasNode>[]) => {
    if (!draft) return;
    const changed = applyNodeChanges(changes, nodes);
    const positions = new Map(changed.map((node) => [node.id, node.position]));
    setDraft({
      ...draft,
      workflow: {
        ...draft.workflow,
        nodes: draft.workflow.nodes.map((node) => ({ ...node, config: { ...node.config, editorPosition: positions.get(node.id) ?? editorPosition(node, 0) } })),
      },
    });
  }, [draft, nodes]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    if (!draft) return;
    const changed = applyEdgeChanges(changes, edges);
    setDraft({ ...draft, workflow: { ...draft.workflow, edges: changed.map((edge) => ({ from: edge.source, to: edge.target })) } });
  }, [draft, edges]);

  const onConnect = useCallback((connection: Connection) => {
    if (!draft || !connection.source || !connection.target || connection.source === connection.target) return;
    const changed = addEdge(connection, edges);
    setDraft({ ...draft, workflow: { ...draft.workflow, edges: changed.map((edge) => ({ from: edge.source, to: edge.target })) } });
  }, [draft, edges]);

  const addNode = (entry: typeof palette[number]) => {
    if (!draft) return;
    const id = `${entry.kind}_${crypto.randomUUID()}`;
    const node: AgentWorkflowNode = {
      id,
      kind: entry.kind,
      config: { editorPosition: { x: 80 + (draft.workflow.nodes.length % 4) * 210, y: 80 + Math.floor(draft.workflow.nodes.length / 4) * 130 } },
      policy: entry.action && entry.mode ? [{ action: entry.action, mode: entry.mode }] : [],
    };
    setDraft({ ...draft, workflow: { ...draft.workflow, nodes: [...draft.workflow.nodes, node] } });
    setSelectedNodeId(id);
  };

  const removeSelected = () => {
    if (!draft || !selectedNodeId) return;
    setDraft({
      ...draft,
      workflow: {
        ...draft.workflow,
        nodes: draft.workflow.nodes.filter((node) => node.id !== selectedNodeId),
        edges: draft.workflow.edges.filter((edge) => edge.from !== selectedNodeId && edge.to !== selectedNodeId),
      },
    });
    setSelectedNodeId(null);
  };

  const save = async () => {
    if (!draft) return;
    setMessage(null);
    const revision = Math.max(draft.workflowRevision, draft.workflow.revision) + 1;
    try {
      const saved = await saveDefinition({
        ...draft,
        workflow: { ...draft.workflow, revision },
        workflowRevision: revision,
        updatedAt: new Date().toISOString(),
      });
      setDraft(saved);
      setMessage(`Saved revision ${revision}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const exportMf = async () => {
    if (!draft) return;
    setMessage(null);
    try {
      const result = await workflowsWriteMf(agentDefinitionToMf(draft));
      setMessage(`Exported ${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const importMf = async (path: string) => {
    if (!draft) return;
    setMfPickerOpen(false);
    setMessage(null);
    try {
      const result = await workflowsReadMf(path);
      const errors = validateMfWorkflow(result.document);
      const unsupported = result.document.nodes.filter((node) => !labelByKind.has(node.kind as AgentWorkflowNodeKind));
      if (errors.length || unsupported.length) {
        throw new Error(errors[0] ?? `Unsupported Agent nodes: ${unsupported.map((node) => node.kind).join(", ")}.`);
      }
      const revision = Math.max(draft.workflowRevision, draft.workflow.revision) + 1;
      setDraft({
        ...draft,
        name: result.document.name,
        instructions: result.document.description || draft.instructions,
        workflow: mfToAgentWorkflow(result.document, revision),
        workflowId: result.document.id,
        workflowRevision: revision,
        status: "draft",
        updatedAt: new Date().toISOString(),
      });
      setSelectedNodeId(null);
      setMessage("Imported .mf workflow as a draft. Save to apply it to this Agent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!draft) {
    return <main className="agent-workflow-editor"><header><Link to={spaceId ? `/spaces/${encodeURIComponent(spaceId)}/studio/folder-agents` : "/agents"}><ArrowLeft size={15} /> Folder agents</Link><h1>Agent workflow</h1></header><p>{loading ? "Loading…" : "This agent could not be found in this Space."}</p></main>;
  }

  return (
    <main className="agent-workflow-editor">
      <header className="agent-workflow-toolbar">
        <div><Link to={spaceId ? `/spaces/${encodeURIComponent(spaceId)}/studio/folder-agents` : "/agents"}><ArrowLeft size={15} /> Folder agents</Link><span><Bot size={16} /> {draft.name}</span><strong>Workflow revision {draft.workflowRevision}</strong></div>
        <div>{message ? <small>{message}</small> : null}<button type="button" onClick={() => setMfPickerOpen(true)}><FileUp size={14} /> Import .mf</button><button type="button" onClick={() => void exportMf()}><FileDown size={14} /> Export .mf</button><button type="button" disabled={!selectedNodeId} onClick={removeSelected}><Trash2 size={14} /> Remove</button><button type="button" disabled={saving} onClick={() => void save()}><Save size={14} /> Save workflow</button></div>
      </header>
      <section className="agent-workflow-body">
        <aside><strong>Agent nodes</strong>{palette.filter((entry) => entry.available !== false).map((entry) => <button key={entry.kind} type="button" onClick={() => addNode(entry)}><Plus size={13} /> {entry.label}</button>)}</aside>
        <div className="agent-workflow-canvas">
          <ReactFlow<AgentCanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls />
          </ReactFlow>
        </div>
      </section>
      {mfPickerOpen ? <MistyFilePicker mode="file" title="Import an Agent workflow" allowedExtensions={["mf"]} onCancel={() => setMfPickerOpen(false)} onSelect={(path) => void importMf(path)} /> : null}
    </main>
  );
}

function AgentWorkflowCanvasNode({ data, selected }: NodeProps<AgentCanvasNode>) {
  return <div className={`agent-workflow-node${selected ? " is-selected" : ""}`}><Handle type="target" position={Position.Left} /><span>{data.label}</span><small>{data.kind}</small><Handle type="source" position={Position.Right} /></div>;
}

function editorPosition(node: AgentWorkflowNode, index: number): { x: number; y: number } {
  const value = node.config.editorPosition;
  if (value && typeof value === "object") {
    const position = value as Record<string, unknown>;
    if (typeof position.x === "number" && typeof position.y === "number") return { x: position.x, y: position.y };
  }
  return { x: 80 + (index % 4) * 210, y: 80 + Math.floor(index / 4) * 130 };
}
