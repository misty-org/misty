import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  CircleX,
  Cloud,
  Ellipsis,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  ImageOff,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { resolveRuntimeAssetReference, runtimeAssetPath } from "@/platform/runtimeAsset";
import { useAppStore } from "@/stores/app";

export interface AssetIconProps {
  src: string;
  size?: number;
  color?: boolean;
  className?: string;
  title?: string;
}

export interface MaskIconStyle extends CSSProperties {
  WebkitMask: string;
  mask: string;
}
