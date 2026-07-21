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
import { useDocumentSurfaceVariables } from "../useDocumentSurfaceVariables";
import { isVideoWallpaperPath } from "./helpers";

export function useDesktopFrameStyle() {
  const app = useAppStore((state) => state.app);
  const { customTokens, resolvedTheme, setSystemTheme, themeId, themeMode } = useAppThemeStore(
    useShallow((state) => ({
      customTokens: state.customTokens,
      resolvedTheme: state.resolvedTheme,
      setSystemTheme: state.setSystemTheme,
      themeId: state.themeId,
      themeMode: state.themeMode,
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
    () => runtimeAssetSource(app?.environment.assetsDir, "logos/misty.png"),
    [app?.environment.assetsDir],
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
    const appBodyBackground = "var(--misty-bg)";
    const appNavBackground = appWallpaperSrc
      ? `rgba(16, 16, 16, ${panelOpacity})`
      : "var(--misty-nav-bg)";
    const appSurfaceBackground = "var(--misty-surface)";
    const wallpaperFrameVars = appWallpaperSrc
      ? {
          "--misty-frame-background": "transparent",
          "--misty-frame-navigation": appNavBackground,
          "--misty-frame-control-bg": `rgba(244, 244, 245, ${neutralControlOpacity})`,
          "--misty-frame-control-hover-bg": `rgba(244, 244, 245, ${neutralHoverOpacity})`,
          "--misty-frame-control-selected-bg": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--misty-frame-control-strong-bg": `rgba(244, 244, 245, ${neutralStrongOpacity})`,
          "--misty-frame-control-border": `rgba(244, 244, 245, ${neutralBorderOpacity})`,
        }
      : {};
    return {
      "--misty-app-panel-opacity": String(panelOpacity),
      "--misty-app-panel-opacity-strong": String(strongPanelOpacity),
      "--misty-app-chrome-opacity": String(chromePanelOpacity),
      "--misty-app-tab-opacity": String(tabPanelOpacity),
      "--misty-app-tab-active-opacity": String(activeTabPanelOpacity),
      "--misty-app-frame-bg": "var(--misty-frame-background)",
      "--misty-app-page-bg": appBodyBackground,
      "--misty-app-shell-bg": appBodyBackground,
      "--misty-app-nav-bg": "var(--misty-frame-navigation)",
      "--misty-app-route-bg": appBodyBackground,
      "--misty-app-panel-bg": "var(--misty-component-surface)",
      "--misty-app-pane-bg": appSurfaceBackground,
      "--misty-app-surface-bg": appSurfaceBackground,
      "--misty-app-surface-soft-bg": "var(--misty-component-surface-raised)",
      "--misty-app-tab-bg": appBodyBackground,
      "--misty-app-tab-active-bg": appSurfaceBackground,
      "--misty-app-modal-bg": "var(--misty-component-surface)",
      ...wallpaperFrameVars,
    } as unknown as CSSProperties;
  }, [appWallpaperSrc, appearancePreferences.panelOpacity]);
  useDocumentSurfaceVariables(desktopFrameStyle);
  const desktopNavbarStyle = useMemo(
    () =>
      ({
        backgroundColor: "var(--misty-app-nav-bg,var(--misty-bg))",
      }) satisfies CSSProperties,
    [],
  );

  useDocumentThemeSync({ appearancePreferences, resolvedTheme, themeId, themeMode });
  useDocumentFrameCssVars(appWallpaperSrc, desktopFrameStyle);
  useDocumentCustomTokens(customTokens, desktopFrameStyle);
  useSystemThemeListener(setSystemTheme);

  return {
    app,
    appWallpaperSrc,
    appWallpaperIsVideo,
    mistyLogoSource,
    desktopFrameStyle,
    desktopNavbarStyle,
  };
}

function useDocumentThemeSync(params: {
  appearancePreferences: ReturnType<typeof selectAppearancePreferences>;
  resolvedTheme: string;
  themeId: string;
  themeMode: string;
}) {
  const { appearancePreferences, resolvedTheme, themeId, themeMode } = params;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.mistyTheme = themeId;
    root.dataset.themeMode = themeMode;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.compactMode = String(appearancePreferences.compactModeEnabled);
    root.dataset.fontSize = appearancePreferences.fontSize;
    root.dataset.reducedMotion = String(appearancePreferences.reducedMotionEnabled);
    root.dataset.thumbnailPreviews = String(appearancePreferences.thumbnailPreviewsEnabled);
    root.dataset.uiScale = appearancePreferences.uiScale;
    root.style.colorScheme = resolvedTheme;
  }, [appearancePreferences, resolvedTheme, themeId, themeMode]);
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

function useSystemThemeListener(setSystemTheme: (mode: "light" | "dark") => void) {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => setSystemTheme(query.matches ? "light" : "dark");
    syncSystemTheme();
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, [setSystemTheme]);
}
