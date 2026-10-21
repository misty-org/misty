import { Pressable } from "@/shared/ui";
import { useCallback, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "./RestoreGlyph";
import * as styles from "./styles";
import { useNativeMaximizeButton } from "./useNativeMaximizeButton";

/** Close, maximize and minimize buttons drawn in the Windows titlebar. */
export const windowsCaptionSlotId = "misty-windows-caption-slot";

export function WindowsTitlebarControls(props: {
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
    : styles.windowsTitlebarControlButtonClass;
  const maximizeRef = useRef<HTMLButtonElement>(null);
  const toggleMaximize = useCallback(() => {
    cancelSnapLayouts();
    void toggleTitlebarMaximize().catch(() => undefined);
  }, [cancelSnapLayouts, toggleTitlebarMaximize]);
  // Windows sees this button as the window's own, so Snap Layouts opens under it; the pointer
  // there then reaches the page as these events instead.
  const maximizeHovered = useNativeMaximizeButton(maximizeRef, true, toggleMaximize);
  const closeButton = slot
    ? `${styles.windowsInlineControlButtonClass} hover:bg-charcoal-active hover:text-cream-bright`
    : styles.windowsTitlebarCloseButtonClass;
  const controls = (
    <div
      ref={controlsRef}
      className={slot ? styles.windowsInlineControlsClass : styles.windowsTitlebarControlsClass}
      data-misty-window-drag-block="true"
      style={slot ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <Pressable
        aria-label="Close window"
        className={closeButton}
        title="Close"
        onClick={closeTitlebarWindow}
      >
        <CloseGlyph />
      </Pressable>
      <Pressable
        ref={maximizeRef}
        className={`${button} data-[hover]:bg-charcoal-hover data-[hover]:text-cream`}
        data-hover={maximizeHovered ? "" : undefined}
        aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
        title={isWindowMaximized ? "Restore" : "Maximize"}
        onPointerEnter={showSnapLayoutsSoon}
        onPointerLeave={cancelSnapLayouts}
        onClick={toggleMaximize}
      >
        {isWindowMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </Pressable>
      <Pressable
        aria-label="Minimize window"
        className={button}
        title="Minimize"
        onClick={minimizeTitlebarWindow}
      >
        <MinimizeGlyph />
      </Pressable>
    </div>
  );
  return slot ? createPortal(controls, slot) : controls;
}
