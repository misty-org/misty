import { isNavigatorAppId, WorkspaceAppIcon } from "@/features/workspace";
import { Puzzle } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type MarketplaceCatalogIconProps = {
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

export function MarketplaceCatalogIcon({
  pluginId,
  pluginName,
  logoSrc,
  className = "",
  textClassName = "text-xs font-semibold text-cream-bright",
  roundedClassName = "rounded-xl",
  imageClassName = "h-[72%] w-[72%] object-contain",
  size,
  style,
}: MarketplaceCatalogIconProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [cacheBust, setCacheBust] = useState(() => Date.now().toString());

  useEffect(() => {
    setImgFailed(false);
    setCacheBust(Date.now().toString());
  }, [logoSrc]);

  const src =
    logoSrc && !imgFailed ? `${logoSrc}${logoSrc.includes("?") ? "&" : "?"}t=${cacheBust}` : "";
  const sizedStyle = size ? { width: size, height: size, ...style } : style;
  const builtInAppId = pluginId?.startsWith("builtin:") ? pluginId.slice("builtin:".length) : "";
  if (isNavigatorAppId(builtInAppId)) {
    return <WorkspaceAppIcon appId={builtInAppId} className={className} size="marketplace" />;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border border-charcoal-border bg-charcoal-card ${roundedClassName} ${textClassName} ${className}`}
      data-plugin-icon={normalizedMarketplaceCatalogIconId(pluginId)}
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
        <Puzzle aria-hidden="true" size={20} strokeWidth={1.9} />
      )}
    </span>
  );
}

function normalizedMarketplaceCatalogIconId(pluginId?: string): string {
  return (pluginId || "generic").trim().toLowerCase().replace(/-/g, "_") || "generic";
}
