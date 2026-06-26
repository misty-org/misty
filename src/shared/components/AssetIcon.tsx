import type { CSSProperties } from "react";

interface AssetIconProps {
  src: string;
  size?: number;
  color?: boolean;
  className?: string;
  title?: string;
}

interface MaskIconStyle extends CSSProperties {
  WebkitMask: string;
  mask: string;
}

const assetIconBaseClass =
  "inline-block shrink-0 align-[-0.125em]";

export function AssetIcon(props: AssetIconProps) {
  const size = props.size ?? 16;
  const className = `${assetIconBaseClass}${props.className ? ` ${props.className}` : ""}`;
  if (props.color) {
    return (
      <img
        className={`${className} object-contain`}
        src={props.src}
        width={size}
        height={size}
        alt={props.title ?? ""}
        aria-hidden={props.title ? undefined : true}
      />
    );
  }
  return (
    <span
      className={className}
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : true}
      style={{
        WebkitMask: `url("${props.src}") center / contain no-repeat`,
        background: "currentColor",
        mask: `url("${props.src}") center / contain no-repeat`,
        width: size,
        height: size,
      } as MaskIconStyle}
    />
  );
}
