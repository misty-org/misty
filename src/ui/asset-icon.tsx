import { useEffect, useState, type CSSProperties } from "react";
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

const assetIconBaseClass = "inline-block shrink-0 align-[-0.125em]";

export function AssetIcon(props: AssetIconProps) {
  const size = props.size ?? 16;
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const source = resolveRuntimeAssetReference(props.src, assetsDir);
  const runtimePath = runtimeAssetPath(props.src);
  const [available, setAvailable] = useState(() => runtimePath === null && Boolean(source));
  const Fallback = fallbackIcon(runtimePath);

  useEffect(() => {
    if (runtimePath === null) {
      setAvailable(Boolean(source));
      return;
    }
    if (!source) {
      setAvailable(false);
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => active && setAvailable(true);
    image.onerror = () => active && setAvailable(false);
    image.src = source;
    return () => {
      active = false;
    };
  }, [runtimePath, source]);

  const className = `${assetIconBaseClass}${props.className ? ` ${props.className}` : ""}`;
  if (!available) {
    return (
      <Fallback
        className={className}
        size={size}
        aria-label={props.title}
        aria-hidden={props.title ? undefined : true}
      />
    );
  }
  if (props.color) {
    return (
      <img
        className={`${className} object-contain`}
        src={source}
        width={size}
        height={size}
        alt={props.title ?? ""}
        aria-hidden={props.title ? undefined : true}
        onError={() => setAvailable(false)}
      />
    );
  }
  return (
    <span
      className={className}
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : true}
      style={
        {
          WebkitMask: `url("${source}") center / contain no-repeat`,
          background: "currentColor",
          mask: `url("${source}") center / contain no-repeat`,
          width: size,
          height: size,
        } as MaskIconStyle
      }
    />
  );
}

function fallbackIcon(path: string | null): LucideIcon {
  const value = path?.toLowerCase() ?? "";
  if (value.includes("activity-check")) return CheckCircle2;
  if (value.includes("eye-closed")) return EyeOff;
  if (value.includes("eye")) return Eye;
  if (value.includes("file-directory-open")) return FolderOpen;
  if (value.includes("file-directory")) return Folder;
  if (value.includes("gear")) return Settings;
  if (value.includes("kebab")) return Ellipsis;
  if (value.includes("plus")) return Plus;
  if (value.includes("shield")) return ShieldCheck;
  if (value.includes("sync")) return RefreshCw;
  if (value.includes("trash")) return Trash2;
  if (value.includes("verified")) return BadgeCheck;
  if (value.includes("x-circle")) return CircleX;
  if (/(^|\/)x(?:-|\.)/.test(value)) return X;
  if (value.includes("cloud") || value.includes("drive") || value.includes("dropbox")) return Cloud;
  return ImageOff;
}

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
