import { isAuthPath } from "@/features/app-shell";
import type { useWindowDockingLayout } from "@/features/workspace";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { dockingGeometry } from "./dockingGeometry";
import { standaloneWorkspaceRouteTitle } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useMergedTitlebar } from "./useMergedTitlebar";

/** Titlebar insets and docking geometry for the current route and docking layout. */
export function useDesktopTitlebarGeometry(options: {
  shellRef: RefObject<HTMLElement | null>;
  pathname: string;
  docking: ReturnType<typeof useWindowDockingLayout>;
  navigatorAutoHide: boolean;
  focusMode: boolean;
  shouldShowWindowsControls: boolean;
  appZoom: number;
}) {
  const {
    shellRef,
    pathname,
    docking,
    navigatorAutoHide,
    focusMode,
    shouldShowWindowsControls,
    appZoom,
  } = options;
  const titlebarNavigationGeometry = styles.desktopTitlebarNavigationGeometry(
    appZoom,
    shouldShowWindowsControls
      ? styles.windowsTitlebarNavigationInset
      : styles.desktopTitlebarNavigationInset,
  );
  const isAuthRoute = isAuthPath(pathname);
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(pathname);
  const sharedTitlebar =
    !isAuthRoute &&
    !standaloneRouteTitle &&
    !focusMode &&
    docking.tabs === "top" &&
    !(docking.navigation === "top" && !navigatorAutoHide);
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
  const tabsFollowNavigator = docking.navigation === "left" && !navigatorAutoHide;
  const geometry = dockingGeometry({
    ...docking,
    autoHide: navigatorAutoHide,
    shareTopBand: !isAuthRoute && !standaloneRouteTitle && !focusMode,
    chromeLeft: titlebarNavigationGeometry.left,
    chromeRight: shouldShowWindowsControls ? (windowsTitlebarControlsWidth || 140) / appZoom : 0,
  });
  const topTabInsets = geometry.titlebarInsets;
  useMergedTitlebar(
    shellRef,
    `${docking.navigation}:${docking.tabs}:${navigatorAutoHide}:${focusMode}`,
    !isAuthRoute,
    titlebarNavigationGeometry.left,
    shouldShowWindowsControls ? (windowsTitlebarControlsWidth || 140) / appZoom : 0,
  );

  return {
    isAuthRoute,
    standaloneRouteTitle,
    sharedTitlebar,
    windowsTitlebarControlsRef,
    titlebarNavigationGeometry,
    tabsFollowNavigator,
    geometry,
    topTabInsets,
  };
}
