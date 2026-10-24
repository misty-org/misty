import { clientMetadata } from "@/telemetry/metadata";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { Button } from "@/shared/ui";
import {
  AlertTriangle,
  Compass,
  Download,
  ExternalLink,
  PanelTopOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useSetupStore } from "@/features/setup";
import { useState } from "react";
import { buildPublicFeedbackIssueUrl, type FeedbackDraft } from "./feedbackIssue";
import { downloadSupportBundle } from "./supportBundle";
import {
  recoverLastClosedWorkspaceTab,
  reloadMisty,
  resetWorkspaceLayout,
} from "./recoveryActions";

import { RecoveryAction, SupportSectionBlock } from "./SupportRecoveryParts";
import { SupportFeedbackFields } from "./SupportFeedbackFields";

const initialDraft: FeedbackDraft = {
  kind: "bug",
  summary: "",
  area: "General",
  details: "",
  expected: "",
  frequency: "unknown",
};

export function SupportRecoverySection({ onClose }: { onClose?: () => void } = {}) {
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<"bundle" | "feedback" | "">("");
  const [resetArmed, setResetArmed] = useState(false);
  const [reloadArmed, setReloadArmed] = useState(false);

  const reopenSetup = () => {
    onClose?.();
    window.dispatchEvent(new CustomEvent("misty:close-settings"));
    useSetupStore.getState().reopenSetup();
  };

  const updateDraft = <Key extends keyof FeedbackDraft>(key: Key, value: FeedbackDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const openFeedbackTicket = async () => {
    if (!draft.summary.trim() || !draft.details.trim() || working) return;
    setWorking("feedback");
    setNotice("");
    try {
      const metadata = await clientMetadata();
      await openSystemExternalLink(
        buildPublicFeedbackIssueUrl(draft, {
          appVersion: metadata.app_version,
          platform: metadata.platform,
          releaseChannel: metadata.release_channel,
        }),
      );
      setNotice("Your draft opened in GitHub. Review it there before publishing the ticket.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Misty couldn’t open the feedback page.");
    } finally {
      setWorking("");
    }
  };

  const downloadDiagnostics = async () => {
    if (working) return;
    setWorking("bundle");
    setNotice("");
    try {
      await downloadSupportBundle();
      setNotice("Diagnostic bundle saved. Review the JSON file before attaching it publicly.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Misty couldn’t create the bundle.");
    } finally {
      setWorking("");
    }
  };

  const recoverTab = () => {
    setResetArmed(false);
    setReloadArmed(false);
    setNotice(
      recoverLastClosedWorkspaceTab()
        ? "The most recently closed tab is back. Close Settings to return to it."
        : "There isn’t a recently closed tab to recover.",
    );
  };

  const resetLayout = () => {
    setReloadArmed(false);
    if (!resetArmed) {
      setResetArmed(true);
      setNotice(
        "This resets window, pane, and tab arrangement only. Saved content is not deleted.",
      );
      return;
    }
    resetWorkspaceLayout();
    setResetArmed(false);
    setNotice(
      "Workspace layout reset. Your Spaces, notes, files, and account data were untouched.",
    );
  };

  const reload = () => {
    setResetArmed(false);
    if (!reloadArmed) {
      setReloadArmed(true);
      setNotice("Reloading can discard unsaved edits. Save anything important, then confirm.");
      return;
    }
    reloadMisty();
  };

  return (
    <>
      <SupportSectionBlock
        title="Setup"
        description="Choose your theme and layout again, or import from another browser."
      >
        <div className="grid gap-px bg-charcoal-border">
          <RecoveryAction
            icon={Compass}
            title="Run setup again"
            detail="Opens the first-run setup from the beginning. Your current choices stay selected."
            action="Open setup"
            onClick={reopenSetup}
          />
        </div>
      </SupportSectionBlock>

      <SupportSectionBlock
        title="Recover Misty"
        description="Try these safe actions when a tab disappears, the layout feels stuck, or the app needs a fresh start."
      >
        <div className="grid gap-px bg-charcoal-border">
          <RecoveryAction
            icon={PanelTopOpen}
            title="Recover closed tab"
            detail="Bring back the most recently closed workspace tab."
            action="Recover tab"
            onClick={recoverTab}
          />
          <RecoveryAction
            icon={RotateCcw}
            title="Reset workspace layout"
            detail="Reset panes, tabs, and window arrangement without deleting content."
            action={resetArmed ? "Confirm reset" : "Reset layout"}
            emphasized={resetArmed}
            onClick={resetLayout}
          />
          <RecoveryAction
            icon={RefreshCw}
            title="Reload Misty"
            detail="Reload the interface when it stops responding. Unsaved edits may be lost."
            action={reloadArmed ? "Confirm reload" : "Reload app"}
            emphasized={reloadArmed}
            onClick={reload}
          />
        </div>
      </SupportSectionBlock>

      <SupportSectionBlock
        title="Report a problem or share feedback"
        description="Create a reviewable ticket in Misty’s public, source-free feedback repository."
      >
        <div className="grid gap-5 p-5">
          <div className="flex gap-3 rounded-lg border border-charcoal-border bg-charcoal-bg p-3 text-xs leading-5 text-cream-muted">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-notification-red" />
            <p className="m-0">
              Tickets are public. Remove private names, messages, file contents, credentials, and
              anything else you do not want others to see.
            </p>
          </div>

          <SupportFeedbackFields draft={draft} updateDraft={updateDraft} />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-charcoal-border pt-5">
            <Button
              variant="outline"
              disabled={Boolean(working)}
              onClick={() => void downloadDiagnostics()}
            >
              <Download className="size-4" />
              {working === "bundle" ? "Preparing…" : "Download diagnostics"}
            </Button>
            <Button
              variant="primary"
              disabled={!draft.summary.trim() || !draft.details.trim() || Boolean(working)}
              onClick={() => void openFeedbackTicket()}
            >
              {working === "feedback" ? "Opening…" : "Continue to public ticket"}
              <ExternalLink className="size-4" />
            </Button>
          </div>
          <div className="flex gap-2 text-xs leading-5 text-cream-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sage-fg" />
            <p className="m-0">
              Diagnostics are created locally and redacted. Misty never uploads or attaches the
              bundle automatically.
            </p>
          </div>
        </div>
      </SupportSectionBlock>

      {notice ? (
        <p
          className="rounded-lg border border-charcoal-border bg-charcoal-card px-4 py-3 text-xs text-cream-muted"
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}
