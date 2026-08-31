import { AuthProvider, useAuth } from "@/features/auth";
import { GlobalMisty, useGlobalSearchStore } from "@/features/global-search";
import { ShortcutRuntime, useShortcutHandler } from "@/features/shortcuts";
import { useSpacesStore } from "@/features/spaces";
import mistyCompanion from "@/shared/assets/misty-cloud-expression-cycle.webp";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MemoryRouter } from "react-router-dom";
import {
  desktopPetEvents,
  revealMainMistyApp,
  toggleDesktopMistyPanel,
  type DesktopMistyAppAction,
  type MistyDesktopSurface,
} from "./desktopPet";
import {
  centeredSurfacePosition,
  logicalWorkArea,
  petSize,
  readSavedPanelSize,
  readSavedPetPosition,
  safePetPosition,
  savePanelSize,
  savePetPosition,
  type PetPosition,
} from "./petGeometry";
import "./desktopPet.css";

const panelWidth = 808;
const panelHeight = 672;
// Header, Search / Ask control, and enough transparent breathing room to avoid
// clipping the panel border inside the native desktop-pet surface.
const compactPanelHeight = 132;
const minimumPanelWidth = 480;
const minimumPanelHeight = 360;
const panelScreenMargin = 14;
const petFadeDurationMs = 180;
const panelExitDurationMs = 320;

function afterDelay(duration: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, duration));
}

function afterTwoFrames() {
  return new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
  );
}

export function MistyDesktopSurfaceRoot({
  surface,
}: {
  surface: Exclude<MistyDesktopSurface, null>;
}) {
  useEffect(() => {
    document.documentElement.dataset.mistyDesktopSurface = surface;
    return () => {
      delete document.documentElement.dataset.mistyDesktopSurface;
    };
  }, [surface]);

  return (
    <MemoryRouter>
      <AuthProvider>
        <ShortcutRuntime />
        <MistyDesktopPet />
      </AuthProvider>
    </MemoryRouter>
  );
}

function MistyDesktopPet() {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [petHidden, setPetHidden] = useState(false);
  const expandedRef = useRef(false);
  const petPositionRef = useRef<PetPosition | null>(null);
  const collapseTimerRef = useRef<number | undefined>(undefined);
  const geometryAnimationRef = useRef(0);
  const ignoreMovesUntilRef = useRef(0);
  const ignoreResizesUntilRef = useRef(0);
  const panelSizeRef = useRef(readSavedPanelSize());
  const hiddenRef = useRef(false);
  const pointer = useRef<{ x: number; y: number; dragging: boolean } | undefined>(undefined);

  const placeWindow = useCallback(
    async (position: PetPosition, size: { width: number; height: number }) => {
      if (!hasTauriInternals()) return;
      geometryAnimationRef.current += 1;
      ignoreMovesUntilRef.current = Date.now() + 180;
      ignoreResizesUntilRef.current = Date.now() + 240;
      const current = getCurrentWebviewWindow();
      await current.setPosition(new LogicalPosition(position.x, position.y));
      await current.setSize(new LogicalSize(size.width, size.height));
    },
    [],
  );

  const collapse = useCallback(async () => {
    if (!expandedRef.current || hiddenRef.current) return;
    expandedRef.current = false;
    if (!hasTauriInternals()) return;
    const current = getCurrentWebviewWindow();
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    const position = safePetPosition(
      petPositionRef.current ?? readSavedPetPosition(),
      monitors,
      primary,
    );
    setPetHidden(true);
    setExpanded(false);
    await current.setResizable(false);
    await current.setMinSize(null);
    await placeWindow(position, { width: petSize, height: petSize });
    await afterTwoFrames();
    if (!hiddenRef.current) setPetHidden(false);
    await current.show();
    await current.unminimize();
    petPositionRef.current = position;
    savePetPosition(position);
  }, [placeWindow]);

  const scheduleCollapse = useCallback(
    (delay = panelExitDurationMs) => {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = window.setTimeout(() => void collapse(), delay);
    },
    [collapse],
  );

  const requestCollapse = useCallback(() => {
    const search = useGlobalSearchStore.getState();
    if (search.panel !== "closed") {
      search.closePanel();
      scheduleCollapse();
      return;
    }
    scheduleCollapse(0);
  }, [scheduleCollapse]);

  const resizePanel = useCallback(
    async (showContent: boolean) => {
      if (!expandedRef.current || !hasTauriInternals()) return;
      const current = getCurrentWebviewWindow();
      const [physicalPosition, physicalSize, currentDisplay, primary] = await Promise.all([
        current.outerPosition(),
        current.outerSize(),
        currentMonitor(),
        primaryMonitor(),
      ]);
      const monitor = currentDisplay ?? primary;
      const scaleFactor = monitor?.scaleFactor ?? 1;
      const position = physicalPosition.toLogical(scaleFactor);
      const size = physicalSize.toLogical(scaleFactor);
      const savedSize = panelSizeRef.current;
      let targetWidth = Math.max(minimumPanelWidth, savedSize?.width ?? panelWidth);
      let targetHeight = showContent
        ? Math.max(minimumPanelHeight, savedSize?.height ?? panelHeight)
        : compactPanelHeight;
      let workArea: ReturnType<typeof logicalWorkArea> | undefined;

      if (monitor) {
        workArea = logicalWorkArea(monitor);
        targetWidth = Math.min(targetWidth, workArea.width - panelScreenMargin * 2);
        targetHeight = Math.min(targetHeight, workArea.height - panelScreenMargin * 2);
      }

      if (!showContent) {
        await current.setResizable(false);
        await current.setMinSize(null);
      }

      if (Math.abs(size.width - targetWidth) >= 1 || Math.abs(size.height - targetHeight) >= 1) {
        await placeWindow(
          centeredSurfacePosition(
            position,
            size,
            { width: targetWidth, height: targetHeight },
            workArea,
            panelScreenMargin,
          ),
          { width: targetWidth, height: targetHeight },
        );
      }

      if (showContent) {
        await current.setMinSize(
          new LogicalSize(
            Math.min(minimumPanelWidth, targetWidth),
            Math.min(minimumPanelHeight, targetHeight),
          ),
        );
        await current.setResizable(true);
      }
    },
    [placeWindow],
  );
  const handleContentVisibilityChange = useCallback(
    (visible: boolean) => {
      void resizePanel(visible);
    },
    [resizePanel],
  );

  const expand = useCallback(async () => {
    if (expandedRef.current || !hasTauriInternals()) return;
    hiddenRef.current = false;
    window.clearTimeout(collapseTimerRef.current);
    if (user?.id) useGlobalSearchStore.getState().setAccount(user.id);
    expandedRef.current = true;
    setPetHidden(true);
    await afterDelay(petFadeDurationMs);
    if (hiddenRef.current) return;
    const current = getCurrentWebviewWindow();
    const [physicalPosition, physicalSize, currentDisplay, primary] = await Promise.all([
      current.outerPosition(),
      current.outerSize(),
      currentMonitor(),
      primaryMonitor(),
    ]);
    const monitor = currentDisplay ?? primary;
    const scaleFactor = monitor?.scaleFactor ?? 1;
    const position = physicalPosition.toLogical(scaleFactor);
    const size = physicalSize.toLogical(scaleFactor);
    petPositionRef.current = { x: position.x, y: position.y };
    savePetPosition(petPositionRef.current);
    const searchState = useGlobalSearchStore.getState();
    const opensWithContent =
      searchState.mode !== "search" ||
      Boolean(searchState.query.trim() || searchState.results.length);
    const savedSize = panelSizeRef.current;
    let targetPanelWidth = Math.max(minimumPanelWidth, savedSize?.width ?? panelWidth);
    let targetPanelHeight = opensWithContent
      ? Math.max(minimumPanelHeight, savedSize?.height ?? panelHeight)
      : compactPanelHeight;
    let targetPanelPosition = centeredSurfacePosition(position, size, {
      width: targetPanelWidth,
      height: targetPanelHeight,
    });

    if (monitor) {
      const workArea = logicalWorkArea(monitor);
      targetPanelWidth = Math.min(targetPanelWidth, workArea.width - panelScreenMargin * 2);
      targetPanelHeight = Math.min(targetPanelHeight, workArea.height - panelScreenMargin * 2);
      targetPanelPosition = centeredSurfacePosition(
        position,
        size,
        { width: targetPanelWidth, height: targetPanelHeight },
        workArea,
        panelScreenMargin,
      );
    }

    await placeWindow(targetPanelPosition, {
      width: targetPanelWidth,
      height: targetPanelHeight,
    });
    if (hiddenRef.current) return;
    if (opensWithContent) {
      await current.setMinSize(
        new LogicalSize(
          Math.min(minimumPanelWidth, targetPanelWidth),
          Math.min(minimumPanelHeight, targetPanelHeight),
        ),
      );
      await current.setResizable(true);
    } else {
      await current.setResizable(false);
      await current.setMinSize(null);
    }
    setExpanded(true);
    setPetHidden(false);
    await current.setAlwaysOnTop(true);
    await current.setFocus();
  }, [placeWindow, user?.id]);

  const togglePanel = useCallback(() => {
    if (expandedRef.current) requestCollapse();
    else void expand();
  }, [expand, requestCollapse]);
  useShortcutHandler("search.toggle", togglePanel);

  const hidePet = useCallback(async () => {
    hiddenRef.current = true;
    window.clearTimeout(collapseTimerRef.current);
    geometryAnimationRef.current += 1;
    const search = useGlobalSearchStore.getState();
    if (search.panel !== "closed") search.closePanel();
    expandedRef.current = false;
    setExpanded(false);
    if (!hasTauriInternals()) return;
    await getCurrentWebviewWindow().hide();
  }, []);

  const openPetContextMenu = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasTauriInternals()) return;
      const { Menu } = await import("@tauri-apps/api/menu");
      const menu = await Menu.new({
        items: [
          { text: "Open Misty Search", action: () => void expand() },
          { text: "Hide Misty", action: () => void hidePet() },
        ],
      });
      try {
        await menu.popup(undefined, getCurrentWebviewWindow());
      } finally {
        await menu.close();
      }
    },
    [expand, hidePet],
  );

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const current = getCurrentWebviewWindow();
    void current.setAlwaysOnTop(true);
    void Promise.all([availableMonitors(), primaryMonitor()]).then(([monitors, primary]) => {
      const saved = safePetPosition(readSavedPetPosition(), monitors, primary);
      petPositionRef.current = saved;
      savePetPosition(saved);
      void current.setSize(new LogicalSize(petSize, petSize));
      void current.setPosition(new LogicalPosition(saved.x, saved.y));
    });

    let settleMoveTimer: number | undefined;
    let removeMove: (() => void) | undefined;
    let removeResize: (() => void) | undefined;
    let removeToggle: (() => void) | undefined;
    void current
      .onMoved(() => {
        if (Date.now() < ignoreMovesUntilRef.current) return;
        window.clearTimeout(settleMoveTimer);
        settleMoveTimer = window.setTimeout(() => {
          if (Date.now() < ignoreMovesUntilRef.current) return;
          void Promise.all([current.outerPosition(), current.outerSize(), currentMonitor()]).then(
            ([physicalPosition, physicalSize, monitor]) => {
              const scaleFactor = monitor?.scaleFactor ?? 1;
              const position = physicalPosition.toLogical(scaleFactor);
              const size = physicalSize.toLogical(scaleFactor);
              if (expandedRef.current) {
                petPositionRef.current = {
                  x: position.x + size.width / 2 - petSize / 2,
                  y: position.y + Math.min(size.height, compactPanelHeight) / 2 - petSize / 2,
                };
                savePetPosition(petPositionRef.current);
                return;
              }
              if (size.width > petSize * 3 || size.height > petSize * 3) return;
              petPositionRef.current = { x: position.x, y: position.y };
              savePetPosition(petPositionRef.current);
            },
          );
        }, 100);
      })
      .then((remove) => {
        removeMove = remove;
      });
    void current
      .onResized(({ payload }) => {
        if (!expandedRef.current || Date.now() < ignoreResizesUntilRef.current) return;
        void currentMonitor().then((monitor) => {
          if (!expandedRef.current || Date.now() < ignoreResizesUntilRef.current) return;
          const size = payload.toLogical(monitor?.scaleFactor ?? 1);
          const savedSize = { width: size.width, height: size.height };
          panelSizeRef.current = savedSize;
          savePanelSize(savedSize);
        });
      })
      .then((remove) => {
        removeResize = remove;
      });
    void current
      .listen(desktopPetEvents.togglePanel, () => {
        togglePanel();
      })
      .then((remove) => {
        removeToggle = remove;
      });
    return () => {
      window.clearTimeout(settleMoveTimer);
      window.clearTimeout(collapseTimerRef.current);
      removeMove?.();
      removeResize?.();
      removeToggle?.();
    };
  }, [togglePanel]);

  useEffect(() => {
    if (!expanded || !user?.id) return;
    const search = useGlobalSearchStore.getState();
    search.setAccount(user.id);
    search.openPanel();
    void useSpacesStore.getState().load({ accountId: user.id });
  }, [expanded, user?.id]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { x: event.clientX, y: event.clientY, dragging: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointer.current;
    if (
      !start ||
      start.dragging ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
    )
      return;
    start.dragging = true;
    void getCurrentWebviewWindow().startDragging();
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const dragged = pointer.current?.dragging;
    pointer.current = undefined;
    if (!dragged) void toggleDesktopMistyPanel();
  };

  if (!expanded) {
    return (
      <main className={`misty-desktop-pet-root${petHidden ? " is-hidden" : ""}`}>
        <button
          type="button"
          className="misty-desktop-pet"
          aria-label="Open Misty Search"
          title="Drag Misty anywhere · Click to open"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(event) => void openPetContextMenu(event)}
        >
          <img src={mistyCompanion} alt="" draggable={false} />
        </button>
      </main>
    );
  }

  if (!user?.id) {
    return (
      <main className="misty-desktop-panel-empty">
        <img src={mistyCompanion} alt="" />
        <div>
          <strong>Open Misty to continue</strong>
          <p>Sign in once, then your desktop pet can search and run Agents from anywhere.</p>
        </div>
        <button type="button" onClick={() => void revealMainMistyApp()}>
          Open Misty
        </button>
        <button type="button" className="misty-desktop-panel-close" onClick={requestCollapse}>
          Close
        </button>
      </main>
    );
  }

  const sendToMain = (action: DesktopMistyAppAction) => {
    void revealMainMistyApp(action);
  };
  return (
    <GlobalMisty
      accountId={user.id}
      currentPath="/"
      activePaneId=""
      activePanePath=""
      includeCurrentContext={false}
      allowCapture={false}
      suspendBrowserWebviews={false}
      showShadow={false}
      onRequestDrag={() => {
        void getCurrentWebviewWindow().startDragging();
      }}
      onSwitchToPet={requestCollapse}
      onContentVisibilityChange={handleContentVisibilityChange}
      onNavigate={(href) => sendToMain({ type: "navigate", href })}
      onCommand={(commandId, tabId) => sendToMain({ type: "command", commandId, tabId })}
      onClosed={() => {
        scheduleCollapse();
      }}
    />
  );
}
