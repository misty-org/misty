import { Button } from "@/ui";
import { Input } from "@/ui";
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { breadcrumbSegments } from "@/features/explorer/utils/fileFormat";
import { cx, toolbarStyles } from "@/features/explorer/components/ExplorerToolbarSupport";

export interface ExplorerPickerToolbarProps {
  path: string;
  query: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoParent: boolean;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
}
