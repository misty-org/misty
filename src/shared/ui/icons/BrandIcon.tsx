import type { CSSProperties } from "react";
import { brandIconAsset } from "./brandIcons";

export interface BrandIconProps {
  brand: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-hidden"?: boolean;
}

/** Single-color marks painted black or white to match the surrounding surface. */
const adaptiveMarks = new Set([
  "anthropic",
  "composio",
  "filen",
  "files-com",
  "github",
  "internet-archive",
  "linear",
  "ollama",
  "openai",
  "typeform",
  "vercel",
  "x",
]);

/** Shared original SVG artwork; never inherit an inactive row's foreground color. */
export function BrandIcon({ brand, size = 24, className, style, title, ...aria }: BrandIconProps) {
  const asset = brandIconAsset(brand);
  if (!asset) return null;
  // Embedded SVG media queries can follow the OS rather than the surrounding
  // WebView surface. Paint monochrome silhouettes using the local color scheme.
  if (adaptiveMarks.has(asset.id)) {
    const mask = `url("${asset.src}") center / contain no-repeat`;
    return (
      <span
        {...aria}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={aria["aria-hidden"] ?? !title}
        title={title}
        className={className}
        data-brand-icon={asset.id}
        data-social-provider-icon={asset.id === "x" ? "x" : undefined}
        style={{
          display: "inline-block",
          flexShrink: 0,
          verticalAlign: "middle",
          width: size,
          height: size,
          ...style,
          WebkitMask: mask,
          mask,
          backgroundColor: "light-dark(#000, #fff)",
        }}
      />
    );
  }
  return (
    <img
      {...aria}
      src={asset.src}
      alt={title ?? ""}
      aria-hidden={aria["aria-hidden"] ?? !title}
      title={title}
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{
        display: "inline-block",
        flexShrink: 0,
        objectFit: "contain",
        verticalAlign: "middle",
        ...style,
      }}
      data-brand-icon={asset.id}
      data-mail-provider-icon={
        asset.id === "gmail" || asset.id === "outlook" ? asset.id : undefined
      }
      data-social-provider-icon={
        ["instagram", "messenger", "x", "discord"].includes(asset.id) ? asset.id : undefined
      }
    />
  );
}
