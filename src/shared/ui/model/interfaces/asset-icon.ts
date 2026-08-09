import type { CSSProperties } from "react";

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
