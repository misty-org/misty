import { useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import "./websiteChrome.css";

/** One modal surface for the app catalog and each provider's settings. */
export function PlatformPanel({
  open,
  title,
  onClose,
  onBack,
  backLabel,
  children,
  surface,
  compact = false,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
  surface?: HTMLElement;
  compact?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current)
    returnFocus.current = document.activeElement as HTMLElement;
  wasOpen.current = open;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={`integration-dialog${compact ? " platform-action-dialog" : ""}`}
        aria-modal="true"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocus.current;
          if (target?.isConnected && target !== document.body) target.focus();
          else
            surface
              ?.querySelector<HTMLElement>("[data-integration-trigger]")
              ?.focus();
        }}
      >
        <div className="platform-panel-heading">
          {onBack && (
            <button
              className="website-icon-button"
              aria-label={`Back to ${backLabel}`}
              onClick={onBack}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <DialogTitle>{title}</DialogTitle>
        </div>
        <div className="platform-panel-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
