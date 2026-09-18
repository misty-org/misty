import { useState, type CSSProperties, type ReactNode } from "react";

import "./styles.css";

export type ExtensionArtworkSize = "small" | "medium" | "large";

export type ExtensionArtworkStyle = CSSProperties & {
  "--misty-extension-artwork-background"?: string;
  "--misty-extension-artwork-border"?: string;
  "--misty-extension-artwork-foreground"?: string;
};

export function ExtensionArtwork({
  alt = "",
  cacheBust = false,
  className = "",
  extensionId,
  imageClassName = "",
  name,
  size = "medium",
  src,
  style,
}: {
  alt?: string;
  cacheBust?: boolean;
  className?: string;
  extensionId?: string;
  imageClassName?: string;
  name: string;
  size?: ExtensionArtworkSize;
  src?: string;
  style?: ExtensionArtworkStyle;
}) {
  const [failedSource, setFailedSource] = useState("");
  const [cacheKey] = useState(() => (cacheBust ? Date.now().toString() : ""));

  const imageSource = (() => {
    if (!src || failedSource === src) return "";
    if (!cacheKey) return src;
    return `${src}${src.includes("?") ? "&" : "?"}misty_ui=${cacheKey}`;
  })();

  return (
    <span
      className={`misty-extension-artwork ${className}`.trim()}
      data-extension-artwork={normalizedExtensionId(extensionId ?? name)}
      data-plugin-icon={normalizedPluginIconId(extensionId ?? name)}
      data-size={size}
      style={style}
    >
      {imageSource ? (
        <img
          alt={alt}
          className={`misty-extension-artwork__image ${imageClassName}`.trim()}
          loading="lazy"
          onError={() => setFailedSource(src ?? "")}
          src={imageSource}
        />
      ) : (
        <svg
          aria-hidden="true"
          className="misty-extension-artwork__fallback"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M9.5 4.75a2.75 2.75 0 1 0 5.5 0H19.25v4.75a2.75 2.75 0 1 1 0 5.5v4.25H15a2.75 2.75 0 1 0-5.5 0H4.75V15A2.75 2.75 0 1 0 4.75 9.5V4.75H9.5Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      )}
    </span>
  );
}

export function ExtensionVerifiedBadge({
  children = "Verified",
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`misty-extension-verified ${className}`.trim()}
      title="Catalog metadata and release artifacts are verified by Misty"
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
        <path
          d="M8 1.75 13 3.6v3.65c0 3.08-1.9 5.58-5 7-3.1-1.42-5-3.92-5-7V3.6L8 1.75Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.35"
        />
        <path
          d="m5.55 7.95 1.55 1.5 3.35-3.35"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.35"
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}

function normalizedExtensionId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") || "generic"
  );
}

function normalizedPluginIconId(value: string) {
  return value.trim().toLowerCase().replace(/-/g, "_") || "generic";
}
