import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Filter,
  KanbanSquare,
  List,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import { Input } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Tabs, TabsList, TabsTrigger } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { confirmAction } from "@/lib/confirmAction";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceIntegration } from "@/models/interfaces/features/spaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceMember,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import {
  memberInitials,
  TaskErrorState,
  toLocalInput,
} from "@/features/spaces/SpaceTaskPrimitives";
import {
  CalendarSourceDrawer,
  SpaceTaskBoard,
  SpaceTaskDrawer,
  SpaceTaskList,
  type TaskDraft,
} from "@/features/spaces/SpacePlannerViews";

export type TaskViewMode = "board" | "list" | "calendar";

export type DueFilter = "all" | "overdue" | "today" | "week" | "no_due";
