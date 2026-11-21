import { Portal, Pressable, Text, Tooltip } from "@misty/ui";
import { useCallback, useRef, type ReactNode, type RefObject } from "react";
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "./RestoreGlyph";
import * as styles from "./styles";
import { useNativeMaximizeButton } from "./useNativeMaximizeButton";

/** The tab row's slot the buttons are seated in, at its far end. */
export const windowsCaptionSlotId = "misty-windows-caption-slot";

/**
 * Minimize, maximize and close, at the window's top-right as every Windows app has them: seated at
 * the tab row's end, the height of its buttons and on its line, or over the window's corner where
 * there is no tab row.
 * On Windows they wear the system's own caption glyphs (Segoe Fluent Icons) and close turns red
 * under the pointer; on Linux, where that font isn't there, they draw the same shapes.
 */
export function WindowsTitlebarControls(props: {
  /** Windows draws the system's caption glyphs; elsewhere they are drawn. */
  systemGlyphs: boolean;
  /** The tab row's slot, when the buttons sit in it instead of over the window's corner. */
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
    systemGlyphs,
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
  const maximizeRef = useRef<HTMLButtonElement>(null);
  const toggleMaximize = useCallback(() => {
    cancelSnapLayouts();
    void toggleTitlebarMaximize().catch(() => undefined);
  }, [cancelSnapLayouts, toggleTitlebarMaximize]);
  // Windows sees this button as the window's own, so Snap Layouts opens under it; the pointer
  // there then reaches the page as these events instead.
  const maximizeHovered = useNativeMaximizeButton(maximizeRef, true, toggleMaximize);
  const glyph = (system: string, drawn: ReactNode) =>
    systemGlyphs ? (
      <span aria-hidden="true" className={styles.windowsSystemGlyphClass}>
        {system}
      </span>
    ) : (
      drawn
    );
  const button = slot
    ? styles.windowsInlineControlButtonClass
    : styles.windowsStandardControlButtonClass;
  const closeButton = slot
    ? styles.windowsInlineCloseButtonClass
    : styles.windowsCloseControlButtonClass;
  const controls = (
    <Text
      bare
      as="div"
      tone="muted"
      ref={controlsRef}
      className={slot ? styles.windowsInlineControlsClass : styles.windowsStandardControlsClass}
      data-misty-window-drag-block="true"
      style={slot ? undefined : { transform: `scale(${scale})`, transformOrigin: "top right" }}
    >
      <Tooltip content="Minimize" side="bottom">
        <Pressable
          aria-label="Minimize window"
          wash="control"
          className={button}
          onClick={minimizeTitlebarWindow}
        >
          {glyph("\uE921", <MinimizeGlyph />)}
        </Pressable>
      </Tooltip>
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
          {isWindowMaximized
            ? glyph("\uE923", <RestoreGlyph />)
            : glyph("\uE922", <MaximizeGlyph />)}
        </Pressable>
      </Tooltip>
      <Tooltip content="Close" side="bottom">
        <Pressable
          aria-label="Close window"
          className={closeButton}
          onClick={closeTitlebarWindow}
        >
          {glyph("\uE8BB", <CloseGlyph />)}
        </Pressable>
      </Tooltip>
    </Text>
  );
  return slot ? <Portal container={slot}>{controls}</Portal> : controls;
}
