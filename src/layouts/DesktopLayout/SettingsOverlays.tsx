import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import SettingsWorkspace from "@/pages/Settings/desktop";
import AccountWorkspace from "@/pages/Account/desktop";
import { settingsOverlayLayerClass, settingsOverlayPanelClass } from "./styles";

export function SettingsOverlay(props: { open: boolean; style: CSSProperties; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className={`app-pages-root ${settingsOverlayLayerClass}`}
      style={props.style}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={panelRef}
        className={settingsOverlayPanelClass}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <SettingsWorkspace presentation="overlay" onClose={props.onClose} />
      </div>
    </div>,
    document.body,
  );
}

export function AccountSettingsOverlay(props: {
  open: boolean;
  style: CSSProperties;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className={`app-pages-root ${settingsOverlayLayerClass}`}
      style={props.style}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className={settingsOverlayPanelClass}
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <AccountWorkspace presentation="overlay" onClose={props.onClose} />
      </div>
    </div>,
    document.body,
  );
}
