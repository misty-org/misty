import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { settingsOverlayLayerClass, settingsOverlayPanelClass } from "./styles";

/**
 * Shared modal shell for the full-page workspaces that are presented as overlays
 * (Settings, Account, Remotes). Handles the portal, the Escape key, and
 * dismiss-on-backdrop-click so each caller only supplies its own content.
 */
export function WorkspaceOverlay(props: {
  open: boolean;
  style: CSSProperties;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { onClose, open } = props;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      data-slot="workspace-overlay"
      className={`app-pages-root ${settingsOverlayLayerClass}`}
      style={props.style}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-slot="workspace-overlay-panel"
        className={settingsOverlayPanelClass}
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
      >
        {props.children}
      </div>
    </div>,
    document.body,
  );
}
