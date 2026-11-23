import { Portal, Pressable, Text, Tooltip } from "@misty/ui";
import { useCallback, useRef, type ReactNode, type RefObject } from "react";
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "./RestoreGlyph";
import * as styles from "./styles";
import { useNativeMaximizeButton } from "./use_native_maximize_button";

export const windowsCaptionSlotId = "misty-windows-caption-slot";

export function WindowsTitlebarControls(props: {
  systemGlyphs: boolean;
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
        <Pressable aria-label="Close window" className={closeButton} onClick={closeTitlebarWindow}>
          {glyph("\uE8BB", <CloseGlyph />)}
        </Pressable>
      </Tooltip>
    </Text>
  );
  return slot ? <Portal container={slot}>{controls}</Portal> : controls;
}
