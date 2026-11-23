import { isAuthPath } from "@/app/shell";
import type { useWindowDockingLayout } from "@/features/app-windows";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSidebarWidthStore } from "@/app/shell/sidebar_width";
import { dockingGeometry } from "./docking_geometry";
import { standaloneWorkspaceRouteTitle } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useMergedTitlebar } from "./use_merged_titlebar";

export function useDesktopTitlebarGeometry(options: {
  shellRef: RefObject<HTMLElement | null>;
  pathname: string;
  docking: ReturnType<typeof useWindowDockingLayout>;
  shouldShowWindowsControls: boolean;
  captionInline: boolean;
  appZoom: number;
}) {
  const { shellRef, pathname, docking, shouldShowWindowsControls, captionInline, appZoom } =
    options;
  const isAuthRoute = isAuthPath(pathname);
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(pathname);
  const windowsTitlebarControlsRef = useRef<HTMLDivElement>(null);
  const [windowsTitlebarControlsWidth, setWindowsTitlebarControlsWidth] = useState(0);
  useLayoutEffect(() => {
    const windowsControls = windowsTitlebarControlsRef.current;
    const measure = () => {
      setWindowsTitlebarControlsWidth(windowsControls?.offsetWidth ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (windowsControls) observer.observe(windowsControls);
    return () => observer.disconnect();
  }, [isAuthRoute, shouldShowWindowsControls, captionInline]);
  const titlebarNavigationGeometry = styles.desktopTitlebarNavigationGeometry(
    appZoom,
    shouldShowWindowsControls ? 0 : styles.desktopTitlebarNavigationInset,
  );
  const captionRight =
    shouldShowWindowsControls && !captionInline
      ? (windowsTitlebarControlsWidth || styles.windowsTitlebarControlsFallbackWidth) /
        (Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1)
      : 0;
  const sideTabsWidth = useSidebarWidthStore((state) => state.width);
  const geometry = dockingGeometry({ sideTabsWidth, ...docking });
  useMergedTitlebar(
    shellRef,
    `${docking.navigation}:${docking.tabs}`,
    !isAuthRoute,
    titlebarNavigationGeometry.left,
    captionRight,
  );

  return {
    isAuthRoute,
    standaloneRouteTitle,
    windowsTitlebarControlsRef,
    titlebarNavigationGeometry,
    geometry,
  };
}
