import type { CSSProperties } from "react";
import { isSideDock, type DockPosition } from "@/features/app-shell/dockingLayout";

/** Top tabs share the native chrome band; other tab edges leave it reserved. */
export function dockingGeometry(
  position: DockPosition,
  width: number,
  hidden: boolean,
  shareTopBand = true,
) {
  const side = isSideDock(position);
  const size = hidden ? 0 : side ? width : 56;
  const frame: CSSProperties = side
    ? {
        gridTemplateColumns:
          position === "left" ? `${size}px minmax(0, 1fr)` : `minmax(0, 1fr) ${size}px`,
        gridTemplateRows: "38px minmax(0, 1fr)",
      }
    : {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows:
          position === "top" ? `38px ${size}px minmax(0, 1fr)` : `38px minmax(0, 1fr) ${size}px`,
      };
  const navigation: CSSProperties = {
    gridColumn: position === "right" ? 2 : 1,
    gridRow: position === "bottom" ? 3 : 2,
    ...(side ? { width } : {}),
  };
  const content: CSSProperties = {
    gridColumn: position === "left" ? 2 : 1,
    gridRow:
      shareTopBand && position !== "top"
        ? position === "bottom"
          ? "1 / 3"
          : "1 / -1"
        : position === "top"
          ? 3
          : 2,
  };
  const floating: CSSProperties = side
    ? {
        top: 38,
        bottom: 0,
        width,
        [position]: 0,
      }
    : {
        left: 0,
        right: 0,
        height: 56,
        [position]: position === "top" ? 38 : 0,
      };
  const reveal: CSSProperties = side ? { ...floating, width: 8 } : { ...floating, height: 8 };
  const translate = {
    left: "translateX(-100%)",
    right: "translateX(100%)",
    top: "translateY(-100%)",
    bottom: "translateY(100%)",
  }[position];
  return { frame, navigation, content, floating, reveal, translate };
}
