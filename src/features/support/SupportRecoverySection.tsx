import { Button, ListCard, ListRow, SectionHeading, notify } from "@/shared/ui";
import { Compass, LayoutDashboard, PanelTopOpen, RefreshCw, Signpost } from "lucide-react";
import { routes } from "@/app/shell";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  recoverLastClosedWorkspaceTab,
  reloadMisty,
  resetWorkspaceLayout,
} from "./recoveryActions";

/** Help's two lists: getting started again, and the safe fixes for a stuck app. */
export function SupportRecoverySection({ onClose }: { onClose?: () => void } = {}) {
  const [armed, setArmed] = useState<"reset" | "reload" | null>(null);
  const navigate = useNavigate();

  const startTour = () => {
    onClose?.();
    window.dispatchEvent(new CustomEvent("misty:start-tour", { detail: "here" }));
  };

  // The first-run setup page: the person's AI and apps, each one already done shown as ready.
  const reopenSetup = () => {
    onClose?.();
    window.dispatchEvent(new CustomEvent("misty:close-settings"));
    navigate(routes.setup);
  };

  const recoverTab = () => {
    setArmed(null);
    if (recoverLastClosedWorkspaceTab()) {
      onClose?.();
      return;
    }
    notify({ message: "There isn't a recently closed tab to recover." });
  };

  const resetLayout = () => {
    setArmed(null);
    resetWorkspaceLayout();
    notify({ message: "Layout reset. Your content wasn't touched." });
  };

  const confirm = (action: "reset" | "reload", label: string, run: () => void) =>
    armed === action ? (
      <Button size="sm" variant="primary" onClick={run}>
        {label}
      </Button>
    ) : null;

  return (
    <div className="grid gap-4">
      <section className="grid gap-1">
        <SectionHeading title="Getting started" />
        <ListCard aria-label="Getting started">
          <li>
            <ListRow
              leading={Signpost}
              label="Show me around"
              description="A short tour of the page you're on"
              onOpen={startTour}
            />
          </li>
          <li>
            <ListRow
              leading={Compass}
              label="Run setup again"
              description="Your AI and apps"
              onOpen={reopenSetup}
            />
          </li>
        </ListCard>
      </section>

      <section className="grid gap-1">
        <SectionHeading title="Recover Misty" />
        <ListCard aria-label="Recover Misty">
          <li>
            <ListRow
              leading={PanelTopOpen}
              label="Recover closed tab"
              description="Bring back the last tab you closed"
              onOpen={recoverTab}
            />
          </li>
          <li>
            <ListRow
              leading={LayoutDashboard}
              label="Reset layout"
              description={
                armed === "reset"
                  ? "Only panes and tabs move. Nothing is deleted."
                  : "Put panes and tabs back where they started"
              }
              onOpen={() => setArmed("reset")}
              trailing={confirm("reset", "Reset", resetLayout)}
            />
          </li>
          <li>
            <ListRow
              leading={RefreshCw}
              label="Reload Misty"
              description={
                armed === "reload"
                  ? "Unsaved edits may be lost."
                  : "For when the app stops responding"
              }
              onOpen={() => setArmed("reload")}
              trailing={confirm("reload", "Reload", reloadMisty)}
            />
          </li>
        </ListCard>
      </section>
    </div>
  );
}
