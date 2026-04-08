import {
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Minus,
  MousePointer2,
  Paintbrush,
  Pipette,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Shapes,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Slider } from "@/ui";
import { defaultGlobalImageEdit, normalizeGlobalImageEdit } from "@/features/editor/imageEditor";
import type {
  GlobalImageEditDefinition,
  GlobalImageMarkupElement,
} from "@/models/interfaces/features/editor/imageEditor";

import type { GlobalImageEditorProps } from "@/models/interfaces/features/editor/GlobalImageEditor";

export type ImageTool = "selection" | "crop" | "text" | "brush" | "eyedropper" | "shape";

export type ImagePoint = { x: number; y: number };

export type ImageCrop = ImagePoint & { width: number; height: number };
