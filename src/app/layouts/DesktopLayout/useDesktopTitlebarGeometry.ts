import { isAuthPath } from "@/app/shell";
import type { useWindowDockingLayout } from "@/features/app-windows";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSidebarWidthStore } from "@/app/shell/sidebarWidth";
import { dockingGeometry } from "./dockingGeometry";
import { standaloneWorkspaceRouteTitle } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useMergedTitlebar } from "./useMergedTitlebar";

/** Titlebar insets and docking geometry for the current route and docking layout. */
export function useDesktopTitlebarGeometry(options: {
  shellRef: RefObject<HTMLElement | null>;
  pathname: string;
  docking: ReturnType<typeof useWindowDockingLayout>;
  shouldShowWindowsControls: boolean;
  /** The caption buttons sit in the tab row, so the window's corner reserves nothing. */
  captionInline: boolean;
  appZoom: number;
}) {
  const {
    shellRef,
    pathname,
    docking,
    shouldShowWindowsControls,
    captionInline,
    appZoom,
  } = options;
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
  // macOS keeps its traffic lights on the left; Windows and Linux keep their caption buttons in
  // the top-right corner, so the toolbars under them make room on that side instead.
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
