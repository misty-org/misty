import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { runtimeAssetSource } from "@/platform/runtimeAsset";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import {
  selectAppearancePreferences,
  useAppStore,
  useAppThemeStore,
  useSettingsStore,
} from "@/stores/app";
import { isVideoWallpaperPath } from "./helpers";

export function useDesktopFrameStyle() {
  const app = useAppStore((state) => state.app);
  const { customTokens, resolvedTheme } = useAppThemeStore(
    useShallow((state) => ({
      customTokens: state.customTokens,
      resolvedTheme: state.resolvedTheme,
    })),
  );
  const appearancePreferences = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );
  const appWallpaperSrc = useMemo(
    () =>
      !isNativeMobileBuild && appearancePreferences.wallpaperPath
        ? safeTauriAssetUrl(appearancePreferences.wallpaperPath)
        : "",
    [appearancePreferences.wallpaperPath],
  );
  const mistyLogoSource = useMemo(
    () =>
      runtimeAssetSource(
        app?.environment.assetsDir,
        resolvedTheme === "dark" ? "logos/misty-white.png" : "logos/misty-black.png",
      ),
    [app?.environment.assetsDir, resolvedTheme],
  );
  const appWallpaperIsVideo = useMemo(
    () => isVideoWallpaperPath(appearancePreferences.wallpaperPath),
    [appearancePreferences.wallpaperPath],
  );
  const desktopFrameStyle = useMemo(() => {
    const panelOpacity = appearancePreferences.panelOpacity;
    const strongPanelOpacity = panelOpacity;
    const chromePanelOpacity = panelOpacity;
    const tabPanelOpacity = panelOpacity;
    const activeTabPanelOpacity = panelOpacity;
    const neutralControlOpacity = Math.min(0.14, 0.045 + panelOpacity * 0.095);
    const neutralHoverOpacity = Math.min(0.17, 0.06 + panelOpacity * 0.12);
    const neutralSelectedOpacity = Math.min(0.22, 0.075 + panelOpacity * 0.145);
    const neutralStrongOpacity = Math.min(0.28, 0.105 + panelOpacity * 0.175);
    const neutralBorderOpacity = Math.min(0.24, 0.08 + panelOpacity * 0.13);
    const appBackground = opacityAwareColor(
      "var(--misty-bg)",
      panelOpacity,
      Boolean(appWallpaperSrc),
    );
    const appSurfaceBackground = "transparent";
    const appRaisedSurfaceBackground = "transparent";
    const appHoverSurfaceBackground = translucentTextColor(neutralHoverOpacity);
    const appSelectedSurfaceBackground = translucentTextColor(neutralSelectedOpacity);
    const wallpaperFrameVars = appWallpaperSrc
      ? {
          "--misty-frame-background": "transparent",
          "--misty-frame-navigation": appBackground,
          "--misty-frame-control-bg": translucentTextColor(neutralControlOpacity),
          "--misty-frame-control-hover-bg": translucentTextColor(neutralHoverOpacity),
          "--misty-frame-control-selected-bg": translucentTextColor(neutralSelectedOpacity),
          "--misty-frame-control-strong-bg": translucentTextColor(neutralStrongOpacity),
          "--misty-frame-control-border": translucentTextColor(neutralBorderOpacity),
          "--misty-neutral-control-bg": translucentTextColor(neutralControlOpacity),
          "--misty-neutral-hover-bg": translucentTextColor(neutralHoverOpacity),
          "--misty-neutral-selected-bg": translucentTextColor(neutralSelectedOpacity),
          "--misty-neutral-strong-bg": translucentTextColor(neutralStrongOpacity),
        }
      : {};
    return {
      "--misty-app-panel-opacity": String(panelOpacity),
      "--misty-app-panel-opacity-strong": String(strongPanelOpacity),
      "--misty-app-chrome-opacity": String(chromePanelOpacity),
      "--misty-app-tab-opacity": String(tabPanelOpacity),
      "--misty-app-tab-active-opacity": String(activeTabPanelOpacity),
      "--misty-runtime-background": appSurfaceBackground,
      "--misty-runtime-navigation": appBackground,
      "--misty-runtime-surface": appSurfaceBackground,
      "--misty-runtime-surface-raised": appRaisedSurfaceBackground,
      "--misty-runtime-surface-hover": appHoverSurfaceBackground,
      "--misty-runtime-sidebar-selected": appSelectedSurfaceBackground,
      "--misty-runtime-popover": appBackground,
      "--misty-app-frame-bg": "var(--misty-frame-background)",
      "--misty-app-page-bg": appSurfaceBackground,
      "--misty-app-shell-bg": appSurfaceBackground,
      "--misty-app-nav-bg": "var(--misty-frame-navigation)",
      "--misty-app-route-bg": appBackground,
      "--misty-app-panel-bg": "var(--misty-component-surface)",
      "--misty-app-pane-bg": appSurfaceBackground,
      "--misty-app-surface-bg": appSurfaceBackground,
      "--misty-app-surface-soft-bg": appRaisedSurfaceBackground,
      "--misty-app-tab-bg": appSurfaceBackground,
      "--misty-app-tab-active-bg": appSurfaceBackground,
      "--misty-app-modal-bg": appBackground,
      ...wallpaperFrameVars,
    } as unknown as CSSProperties;
  }, [appWallpaperSrc, appearancePreferences.panelOpacity]);
  const desktopNavbarStyle = useMemo(
    () =>
      ({
        backgroundColor: "var(--misty-app-nav-bg,var(--misty-bg))",
      }) satisfies CSSProperties,
    [],
  );

  useDocumentFrameCssVars(appWallpaperSrc, desktopFrameStyle);
  useDocumentCustomTokens(customTokens, desktopFrameStyle);

  return {
    app,
    appWallpaperSrc,
    appWallpaperIsVideo,
    mistyLogoSource,
    desktopFrameStyle,
    desktopNavbarStyle,
  };
}

export function opacityAwareColor(token: string, opacity: number, enabled: boolean): string {
  if (!enabled) return token;
  const percentage = Math.round(Math.min(1, Math.max(0, opacity)) * 10_000) / 100;
  return `color-mix(in srgb, ${token} ${percentage}%, transparent)`;
}

function translucentTextColor(opacity: number): string {
  return opacityAwareColor("var(--misty-text)", opacity, true);
}

function useDocumentFrameCssVars(appWallpaperSrc: string, desktopFrameStyle: CSSProperties) {
  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(desktopFrameStyle as Record<string, string>);
    root.dataset.mistyWallpaperActive = appWallpaperSrc ? "true" : "false";
    for (const [key, value] of entries) {
      root.style.setProperty(key, value);
    }

    return () => {
      for (const [key] of entries) {
        root.style.removeProperty(key);
      }
      delete root.dataset.mistyWallpaperActive;
    };
  }, [appWallpaperSrc, desktopFrameStyle]);
}

function useDocumentCustomTokens(
  customTokens: ReturnType<typeof useAppThemeStore.getState>["customTokens"],
  desktopFrameStyle: CSSProperties,
) {
  useEffect(() => {
    const root = document.documentElement;
    const names: Record<string, string> = {
      background: "--misty-bg",
      surface: "--misty-surface",
      foreground: "--misty-text",
      muted: "--misty-text-muted",
      accent: "--misty-accent",
      selection: "--misty-selection",
      success: "--misty-success",
      warning: "--misty-warning",
      danger: "--misty-danger",
    };
    for (const [token, property] of Object.entries(names)) {
      const value = customTokens?.[token as keyof typeof customTokens];
      if (value) root.style.setProperty(property, value);
      else {
        const frameValue = (desktopFrameStyle as Record<string, string>)[property];
        if (frameValue) root.style.setProperty(property, frameValue);
        else root.style.removeProperty(property);
      }
    }
  }, [customTokens, desktopFrameStyle]);
}
