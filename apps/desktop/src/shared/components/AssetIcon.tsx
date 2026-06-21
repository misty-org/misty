import type { CSSProperties } from "react";

interface AssetIconProps {
  src: string;
  size?: number;
  color?: boolean;
  className?: string;
  title?: string;
}

interface MaskIconStyle extends CSSProperties {
  "--asset-icon-url": string;
}

export function AssetIcon(props: AssetIconProps) {
  const size = props.size ?? 16;
  const className = `asset-icon${props.color ? " asset-icon-image" : " asset-icon-mask"}${props.className ? ` ${props.className}` : ""}`;
  if (props.color) {
    return (
      <img
        className={className}
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
        "--asset-icon-url": `url("${props.src}")`,
        width: size,
        height: size,
      } as MaskIconStyle}
    />
  );
}
