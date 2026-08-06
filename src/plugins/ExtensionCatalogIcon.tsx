import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type ExtensionCatalogIconProps = {
  pluginId?: string;
  pluginName?: string;
  logoSrc?: string;
  className?: string;
  textClassName?: string;
  roundedClassName?: string;
  imageClassName?: string;
  size?: number;
  style?: CSSProperties;
};

export function extensionCatalogInitials(pluginName?: string, pluginId?: string): string {
  const source = (pluginName || pluginId || "Extension").trim();
  return source
    .split(/[\s_-]+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ExtensionCatalogIcon({
  pluginId,
  pluginName,
  logoSrc,
  className = "",
  textClassName = "text-xs font-semibold text-cream-bright",
  roundedClassName = "rounded-xl",
  imageClassName = "h-[72%] w-[72%] object-contain",
  size,
  style,
}: ExtensionCatalogIconProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [cacheBust, setCacheBust] = useState(() => Date.now().toString());

  useEffect(() => {
    setImgFailed(false);
    setCacheBust(Date.now().toString());
  }, [logoSrc]);

  const src =
    logoSrc && !imgFailed ? `${logoSrc}${logoSrc.includes("?") ? "&" : "?"}t=${cacheBust}` : "";
  const sizedStyle = size ? { width: size, height: size, ...style } : style;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border border-charcoal-border bg-charcoal-card ${roundedClassName} ${textClassName} ${className}`}
      data-plugin-icon={normalizedExtensionCatalogIconId(pluginId)}
      style={sizedStyle}
    >
      {src ? (
        <img
          alt={`${pluginName || pluginId || "Extension"} logo`}
          className={imageClassName}
          onError={() => setImgFailed(true)}
          src={src}
        />
      ) : (
        extensionCatalogInitials(pluginName, pluginId)
      )}
    </span>
  );
}

function normalizedExtensionCatalogIconId(pluginId?: string): string {
  return (pluginId || "generic").trim().toLowerCase().replace(/-/g, "_") || "generic";
}
