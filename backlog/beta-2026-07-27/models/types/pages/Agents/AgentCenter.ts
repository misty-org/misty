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
import { providerCatalog, providerById } from "@/features/workflows/providers";
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

export type AgentCenterTab =
  "attention" | "results" | "activity" | "history" | "settings" | "studio";

export type AgentRuntime = {
  catalog: AgentCatalogEntry;
  instance?: AgentInstanceRecord;
  runs: SpaceRun[];
};

export type RunDetail = {
  run: SpaceRun;
  actions: RunAction[];
  approvals: RunApproval[];
  steps: WorkflowRunStep[];
};
