import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, History, Play, Plus, Save, Trash2, Workflow } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type {
  RunAction,
  RunApproval,
  SpaceRun,
  WorkflowVersion,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceStudioResource } from "@/models/interfaces/features/spaces/types";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import { errorText } from "@/lib/format";
import { confirmAction } from "@/lib/confirmAction";
import { AgentArchitecturePanel, RunDetailDialog } from "@/pages/Studio/AgentArchitecturePanel";
import { UnifiedWorkflowEditor } from "@/pages/Studio/UnifiedWorkflowEditor";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Checkbox } from "@/ui";
import { Input } from "@/ui";
import { Textarea } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { EmptyState, PermissionState } from "@/ui";
import { StatusBadge } from "@/ui";

export type SpaceStudioKind = "agents" | "workflows";
