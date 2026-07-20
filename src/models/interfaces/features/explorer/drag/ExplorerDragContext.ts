import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { explorerCancelDragPreparation, explorerPrepareDragItems } from "@/stores/backend";
import { getAppliedAppZoom } from "@/hooks/useAppZoom";
import { hasTauriInternals } from "@/platform/tauri";
import { useExplorerStore } from "@/stores/explorer";
import {
  dragDistance,
  edgeScrollDelta,
  physicalToClientPoint,
  selectDropCandidate,
} from "@/features/explorer/drag/geometry";
import { DragInteractionShield } from "@/ui";
import {
  dragAnnouncement,
  ExplorerDragPreview,
  setWebviewDragActive,
} from "@/features/explorer/drag/ExplorerDragPreview";
import type {
  ExplorerDragItem,
  ExplorerDragModifiers,
  ExplorerDragPayload,
  ExplorerDragViewState,
  ExplorerDropZoneSpec,
} from "@/models/interfaces/features/explorer/drag/types";

export interface RegisteredZone {
  element: HTMLElement;
  spec: ExplorerDropZoneSpec;
}

export interface ArmedDrag {
  pointerId: number;
  source: HTMLElement;
  start: { x: number; y: number };
  items: ExplorerDragItem[];
}

export interface PreparedEgress {
  sessionId: string;
  promise: Promise<string[]>;
  settled: boolean;
  paths: string[] | null;
  error: string | null;
}

export interface ExplorerDragContextValue {
  state: ExplorerDragViewState;
  armSource: (items: ExplorerDragItem[], event: ReactPointerEvent<HTMLElement>) => void;
  registerZone: (element: HTMLElement, spec: ExplorerDropZoneSpec) => () => void;
  cancel: (message?: string) => void;
}
