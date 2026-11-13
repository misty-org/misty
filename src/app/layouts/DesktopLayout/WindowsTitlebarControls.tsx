import { Portal, Pressable, Text, Tooltip } from "@/shared/ui";
import { useCallback, useRef, type RefObject } from "react";
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "./RestoreGlyph";
import * as styles from "./styles";
import { useNativeMaximizeButton } from "./useNativeMaximizeButton";

/** Close, maximize and minimize buttons drawn in the Windows titlebar. */
export const windowsCaptionSlotId = "misty-windows-caption-slot";

export function WindowsTitlebarControls(props: {
  /** Signed-out pages: the usual minimize, maximize, close order in the top-right corner. */
  standard?: boolean;
  /** The sidebar header's slot, when the buttons sit inside it instead of over the window. */
  slot: HTMLElement | null;
  controlsRef: RefObject<HTMLDivElement | null>;
  scale: number;
  isWindowMaximized: boolean;
  minimizeTitlebarWindow: () => void;
  closeTitlebarWindow: () => void;
  toggleTitlebarMaximize: () => Promise<unknown>;
  showSnapLayoutsSoon: () => void;
  cancelSnapLayouts: () => void;
}) {
  const {
    standard = false,
    slot,
    controlsRef,
    scale,
    isWindowMaximized,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
    toggleTitlebarMaximize,
    showSnapLayoutsSoon,
    cancelSnapLayouts,
  } = props;
  const button = slot
    ? styles.windowsInlineControlButtonClass
    : standard
      ? styles.windowsStandardControlButtonClass
      : styles.windowsTitlebarControlButtonClass;
  const maximizeRef = useRef<HTMLButtonElement>(null);
  const toggleMaximize = useCallback(() => {
    cancelSnapLayouts();
    void toggleTitlebarMaximize().catch(() => undefined);
  }, [cancelSnapLayouts, toggleTitlebarMaximize]);
  // Windows sees this button as the window's own, so Snap Layouts opens under it; the pointer
  // there then reaches the page as these events instead.
  const maximizeHovered = useNativeMaximizeButton(maximizeRef, true, toggleMaximize);
  const minimize = (
    <Tooltip content="Minimize" side="bottom">
      <Pressable
        aria-label="Minimize window"
        wash="control"
        className={button}
        onClick={minimizeTitlebarWindow}
      >
        <MinimizeGlyph />
      </Pressable>
    </Tooltip>
  );
  const maximize = (
    <Tooltip content={isWindowMaximized ? "Restore" : "Maximize"} side="bottom">
      <Pressable
        ref={maximizeRef}
        wash="control"
        className={button}
        data-hover={maximizeHovered ? "" : undefined}
        aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
        onPointerEnter={showSnapLayoutsSoon}
        onPointerLeave={cancelSnapLayouts}
        onClick={toggleMaximize}
      >
        {isWindowMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </Pressable>
    </Tooltip>
  );
  const close = (
    <Tooltip content="Close" side="bottom">
      <Pressable
        aria-label="Close window"
        wash="strong"
        className={button}
        onClick={closeTitlebarWindow}
      >
        <CloseGlyph />
      </Pressable>
    </Tooltip>
  );
  const controls = (
    <Text
      bare
      as="div"
      tone="muted"
      ref={controlsRef}
      className={
        slot
          ? styles.windowsInlineControlsClass
          : standard
            ? styles.windowsStandardControlsClass
            : styles.windowsTitlebarControlsClass
      }
      data-misty-window-drag-block="true"
      style={
        slot
          ? undefined
          : { transform: `scale(${scale})`, transformOrigin: standard ? "top right" : "top left" }
      }
    >
      {standard && !slot ? (
        <>
          {minimize}
          {maximize}
          {close}
        </>
      ) : (
        <>
          {close}
          {maximize}
          {minimize}
        </>
      )}
    </Text>
  );
  return slot ? <Portal container={slot}>{controls}</Portal> : controls;
}
