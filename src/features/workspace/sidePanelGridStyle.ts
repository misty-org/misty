import type { CSSProperties } from "react";

export function sidePanelGridStyle(options: {
  asideWidth: number;
  compact: boolean;
  hasAside: boolean;
  hasNavigationAside: boolean;
  navigationAsideWidth: number;
}): CSSProperties {
  if (options.compact) return { gridTemplateColumns: "minmax(0, 1fr)" };
  if (options.hasNavigationAside && options.hasAside) {
    return {
      gridTemplateColumns: `${options.navigationAsideWidth}px 1px minmax(0, 1fr) 1px ${options.asideWidth}px`,
    };
  }
  if (options.hasNavigationAside) {
    return { gridTemplateColumns: `${options.navigationAsideWidth}px 1px minmax(0, 1fr)` };
  }
  if (options.hasAside) {
    return { gridTemplateColumns: `minmax(0, 1fr) 1px ${options.asideWidth}px` };
  }
  return { gridTemplateColumns: "minmax(0, 1fr)" };
}
