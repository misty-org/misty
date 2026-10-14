import { Pressable } from "@/shared/ui";
import { Minus, Square, X } from "lucide-react";
import type { RefObject } from "react";
import { RestoreGlyph } from "./RestoreGlyph";
import * as styles from "./styles";

/** Minimize / maximize / close buttons drawn in the Windows titlebar. */
export function WindowsTitlebarControls(props: {
  controlsRef: RefObject<HTMLDivElement | null>;
  scale: number;
  isAuthRoute: boolean;
  isWindowMaximized: boolean;
  minimizeTitlebarWindow: () => void;
  closeTitlebarWindow: () => void;
  toggleTitlebarMaximize: () => Promise<unknown>;
  showSnapLayoutsSoon: () => void;
  cancelSnapLayouts: () => void;
}) {
  const {
    controlsRef,
    scale,
    isAuthRoute,
    isWindowMaximized,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
    toggleTitlebarMaximize,
    showSnapLayoutsSoon,
    cancelSnapLayouts,
  } = props;
  return (
    <div
      ref={controlsRef}
      className={styles.windowsTitlebarControlsClass}
      data-misty-window-drag-block="true"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "top right",
      }}
    >
      {!isAuthRoute ? (
        <div
          id="misty-windows-workspace-controls"
          className={styles.windowsWorkspaceControlsClass}
          data-misty-window-drag-block="true"
        />
      ) : null}
      <Pressable
        aria-label="Minimize window"
        className={styles.windowsTitlebarControlButtonClass}
        title="Minimize"
        onClick={minimizeTitlebarWindow}
      >
        <Minus size={16} strokeWidth={1.5} />
      </Pressable>
      <Pressable
        className={styles.windowsTitlebarControlButtonClass}
        aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
        title={isWindowMaximized ? "Restore" : "Maximize"}
        onPointerEnter={showSnapLayoutsSoon}
        onPointerLeave={cancelSnapLayouts}
        onClick={() => {
          cancelSnapLayouts();
          void toggleTitlebarMaximize().catch(() => undefined);
        }}
      >
        {isWindowMaximized ? <RestoreGlyph /> : <Square size={16} strokeWidth={1.5} />}
      </Pressable>
      <Pressable
        aria-label="Close window"
        className={styles.windowsTitlebarCloseButtonClass}
        title="Close"
        onClick={closeTitlebarWindow}
      >
        <X size={16} strokeWidth={1.5} />
      </Pressable>
    </div>
  );
}
