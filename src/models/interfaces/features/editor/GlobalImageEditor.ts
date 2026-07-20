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

import type {
  ImageTool,
  ImagePoint,
  ImageCrop,
} from "@/models/types/features/editor/GlobalImageEditor";

export interface GlobalImageEditorProps {
  sourceKey: string;
  name: string;
  url: string;
  indexLabel?: string;
  tags?: string[];
  initialEdit?: Partial<GlobalImageEditDefinition> | null;
  outputMimeType?: string;
  loading?: boolean;
  error?: string;
  readonly?: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSave: (edit: GlobalImageEditDefinition, rendered: Blob) => void | Promise<void>;
  onSaveAsCopy: (edit: GlobalImageEditDefinition, rendered: Blob) => void | Promise<void>;
  onSaveTags?: (tags: string[]) => void | Promise<void>;
}
