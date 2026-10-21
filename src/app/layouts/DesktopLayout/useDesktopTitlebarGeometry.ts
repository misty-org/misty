import { isAuthPath } from "@/features/app-shell";
import type { useWindowDockingLayout } from "@/features/workspace";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSidebarWidthStore } from "@/features/app-shell/sidebarWidth";
import { dockingGeometry } from "./dockingGeometry";
import { standaloneWorkspaceRouteTitle } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useMergedTitlebar } from "./useMergedTitlebar";

/** Titlebar insets and docking geometry for the current route and docking layout. */
export function useDesktopTitlebarGeometry(options: {
  shellRef: RefObject<HTMLElement | null>;
  pathname: string;
  docking: ReturnType<typeof useWindowDockingLayout>;
  focusMode: boolean;
  shouldShowWindowsControls: boolean;
  /** The caption buttons sit inside the sidebar, so the window's corner reserves nothing. */
  captionInline: boolean;
  appZoom: number;
}) {
  const {
    shellRef,
    pathname,
    docking,
    focusMode,
    shouldShowWindowsControls,
    captionInline,
    appZoom,
  } = options;
  const isAuthRoute = isAuthPath(pathname);
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(pathname);
  const sharedTitlebar =
    !isAuthRoute && !standaloneRouteTitle && !focusMode && docking.tabs === "top";
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
  }, [isAuthRoute, shouldShowWindowsControls]);
  // The caption buttons sit on the left, where macOS puts its traffic lights, so both platforms
  // share one layout.
  const titlebarNavigationGeometry = styles.desktopTitlebarNavigationGeometry(
    appZoom,
    shouldShowWindowsControls
      ? captionInline
        ? 0
        : windowsTitlebarControlsWidth || styles.windowsTitlebarControlsFallbackWidth
      : styles.desktopTitlebarNavigationInset,
  );
  const sideTabsWidth = useSidebarWidthStore((state) => state.width);
  const geometry = dockingGeometry({
    sideTabsWidth,
    ...docking,
    // The tab strip carries the navigation; no rail takes room.
    autoHide: true,
    shareTopBand: !isAuthRoute && !standaloneRouteTitle && !focusMode,
    chromeLeft: titlebarNavigationGeometry.left,
  });
  const topTabInsets = geometry.titlebarInsets;
  useMergedTitlebar(
    shellRef,
    `${docking.navigation}:${docking.tabs}:${focusMode}`,
    !isAuthRoute,
    titlebarNavigationGeometry.left,
    0,
  );

  return {
    isAuthRoute,
    standaloneRouteTitle,
    sharedTitlebar,
    windowsTitlebarControlsRef,
    titlebarNavigationGeometry,
    geometry,
    topTabInsets,
  };
}
