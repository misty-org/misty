import type { CSSProperties } from "react";
import { brandIconAsset } from "./brandIcons";

interface BrandIconProps {
  brand: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * The brand's name, for a mark that stands alone: its accessible name. Leave it out when a
   * label beside the mark already says it. To show the name on hover, wrap it in a Tooltip.
   */
  label?: string;
  "aria-hidden"?: boolean;
}

/** Single-color marks painted black or white to match the surrounding surface. */
const adaptiveMarks = new Set([
  "anthropic",
  "composio",
  "filen",
  "files-com",
  "fish-audio",
  "github",
  "inception",
  "internet-archive",
  "linear",
  "moonshot",
  "ollama",
  "openai",
  "openrouter",
  "typeform",
  "vercel",
  "x",
  "xai",
  "zai",
]);

/** Shared original SVG artwork; never inherit an inactive row's foreground color. */
export function BrandIcon({
  brand,
  size = 24,
  className,
  style,
  label: name,
  ...aria
}: BrandIconProps) {
  const asset = brandIconAsset(brand);
  if (!asset) return null;
  // Embedded SVG media queries can follow the OS rather than the surrounding
  // WebView surface. Paint monochrome silhouettes using the local color scheme.
  if (adaptiveMarks.has(asset.id)) {
    const mask = `url("${asset.src}") center / contain no-repeat`;
    return (
      <span
        {...aria}
        role={name ? "img" : undefined}
        aria-label={name}
        aria-hidden={aria["aria-hidden"] ?? !name}
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
      alt={name ?? ""}
      aria-hidden={aria["aria-hidden"] ?? !name}
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
