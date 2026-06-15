import type { CSSProperties } from "react";

export function sidePanelGridStyle(options: {
  asideWidth: number;
  compact: boolean;
  hasAside: boolean;
  hasNavigationAside: boolean;
  navigationAsideWidth: number;
}): CSSProperties {
  if (options.compact) {
    // Keep explicitly enabled panels visible, sharing the available width.
    const columns = [
      ...(options.hasNavigationAside
        ? [`min(${options.navigationAsideWidth}px, ${options.hasAside ? "30%" : "40%"})`, "1px"]
        : []),
      "minmax(0, 1fr)",
      ...(options.hasAside ? ["1px", `min(${options.asideWidth}px, 35%)`] : []),
    ];
    return { gridTemplateColumns: columns.join(" ") };
  }

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
