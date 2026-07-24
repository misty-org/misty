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
import { workflowTemplates } from "@/features/workflows/templates";
import { providerById, providerNodeTemplates } from "@/features/workflows/providers";
import type { ProviderNodeTemplate } from "@/models/interfaces/features/workflows/providers";
import {
  createConfiguredWorkflowNode,
  createWorkflowNode,
  validateWorkflowV2,
  workflowNodeRegistry,
} from "@/features/workflows/v2";
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

export type CanvasData = {
  workflow: WorkflowNodeV2;
  descriptor: PaletteDefinition;
  selected: boolean;
};

export type CanvasNode = Node<CanvasData, "workflow">;

export type PaletteDefinition = {
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

export type EditorCategory = "Triggers" | "Files" | "AI" | "Logic" | "Integrations" | "Actions";
