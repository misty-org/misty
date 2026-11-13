import type { ReactNode } from "react";
import { OutOfRow } from "../controls/rowContext";
import { useEffect } from "react";
import { createPortal } from "react-dom";
const settingsOverlayLayerClass = [
  "fixed inset-0 layer-workspace-overlay grid place-items-center bg-scrim px-6 pb-6 pt-[max(1.5rem,var(--misty-modal-inset-top,0px))]",
  "animate-in fade-in-0 duration-200",
].join(" ");
const settingsOverlayPanelClass = [
  "h-[min(900px,calc(100dvh-24px-max(24px,var(--misty-modal-inset-top,0px))))] w-[min(1200px,calc(100dvw-96px))]",
  "min-w-0 overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card shadow-2xl",
  "misty-dialog-motion",
].join(" ");

/**
 * Shared modal shell for the full-page workspaces that are presented as overlays
 * (Settings, Account, Remotes). Handles the portal, the Escape key, and
 * dismiss-on-backdrop-click so each caller only supplies its own content.
 */
export function WorkspaceOverlay(props: {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { onClose, open } = props;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A menu, dialog or field inside that handled Escape itself has it, not the overlay.
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  useEffect(() => {
    if (!open) return;
    // Focus goes back to whatever opened the overlay once it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      data-slot="workspace-overlay"
      className={`app-pages-root ${settingsOverlayLayerClass}`}
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
        <OutOfRow>{props.children}</OutOfRow>
      </div>
    </div>,
    document.body,
  );
}
