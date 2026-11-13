import { clientMetadata } from "./clientMetadata";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { Button, Separator, Surface, Text, useNotice } from "@/shared/ui";
import {
  AlertTriangle,
  Compass,
  Download,
  ExternalLink,
  PanelTopOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Signpost,
} from "lucide-react";
import { routes } from "@/app/shell";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [failure, setFailure] = useState("");
  useNotice(Boolean(failure), { message: failure, tone: "error", onDismiss: () => setFailure("") });
  const [working, setWorking] = useState<"bundle" | "feedback" | "">("");
  const [resetArmed, setResetArmed] = useState(false);
  const [reloadArmed, setReloadArmed] = useState(false);

  const navigate = useNavigate();
  // The first-run setup page: the person's AI and apps, each one already done shown as ready.
  const reopenSetup = () => {
    onClose?.();
    window.dispatchEvent(new CustomEvent("misty:close-settings"));
    navigate(routes.setup);
  };

  const updateDraft = <Key extends keyof FeedbackDraft>(key: Key, value: FeedbackDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const openFeedbackTicket = async () => {
    if (!draft.summary.trim() || !draft.details.trim() || working) return;
    setWorking("feedback");
    setNotice("");
    setFailure("");
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
      setFailure(error instanceof Error ? error.message : "Misty couldn’t open the feedback page.");
    } finally {
      setWorking("");
    }
  };

  const downloadDiagnostics = async () => {
    if (working) return;
    setWorking("bundle");
    setNotice("");
    setFailure("");
    try {
      await downloadSupportBundle();
      setNotice("Diagnostic bundle saved. Review the JSON file before attaching it publicly.");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Misty couldn’t create the bundle.");
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
        title="Getting started"
        description="Take the tour again, or install and sign in to your AI again."
      >
        <div className="grid" data-tour="help-start">
          <RecoveryAction
            icon={Signpost}
            title="Show me around"
            detail="A short tour of the page you're on, or of Misty as a whole from a chat."
            action="Start tour"
            onClick={() => {
              onClose?.();
              window.dispatchEvent(new CustomEvent("misty:start-tour", { detail: "here" }));
            }}
          />
          <Separator />
          <RecoveryAction
            icon={Compass}
            title="Run setup again"
            detail="Your AI and apps, with whatever is already set up marked ready."
            action="Open setup"
            onClick={reopenSetup}
          />
        </div>
      </SupportSectionBlock>

      <SupportSectionBlock
        title="Recover Misty"
        description="Try these safe actions when a tab disappears, the layout feels stuck, or the app needs a fresh start."
      >
        <div className="grid" data-tour="help-recover">
          <RecoveryAction
            icon={PanelTopOpen}
            title="Recover closed tab"
            detail="Bring back the most recently closed workspace tab."
            action="Recover tab"
            onClick={recoverTab}
          />
          <Separator />
          <RecoveryAction
            icon={RotateCcw}
            title="Reset workspace layout"
            detail="Reset panes, tabs, and window arrangement without deleting content."
            action={resetArmed ? "Confirm reset" : "Reset layout"}
            emphasized={resetArmed}
            onClick={resetLayout}
          />
          <Separator />
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
        <div className="grid gap-5 p-5" data-tour="help-feedback">
          <Surface
            tone="page"
            edge="hairline"
            radius="lg"
            className="flex gap-3 p-3 text-xs leading-5"
          >
            <AlertTriangle className="mt-0.5 shrink-0 text-notification-red" />
            <Text bare as="p" tone="muted" className="m-0">
              Tickets are public. Remove private names, messages, file contents, credentials, and
              anything else you do not want others to see.
            </Text>
          </Surface>

          <SupportFeedbackFields draft={draft} updateDraft={updateDraft} />

          <div className="flex min-w-0 items-center justify-between gap-3 border-t pt-5">
            <Button
              variant="secondary"
              icon={Download}
              disabled={working === "feedback"}
              loading={working === "bundle"}
              onClick={() => void downloadDiagnostics()}
            >
              Download diagnostics
            </Button>
            <Button
              variant="primary"
              iconEnd={ExternalLink}
              disabled={!draft.summary.trim() || !draft.details.trim() || working === "bundle"}
              loading={working === "feedback"}
              onClick={() => void openFeedbackTicket()}
            >
              Continue to public ticket
            </Button>
          </div>
          <Text bare as="div" tone="muted" className="flex gap-2 text-xs leading-5">
            <ShieldCheck className="mt-0.5 shrink-0" />
            <p className="m-0">
              Diagnostics are created locally and redacted. Misty never uploads or attaches the
              bundle automatically.
            </p>
          </Text>
        </div>
      </SupportSectionBlock>

      {notice ? (
        <Surface
          as="p"
          tone="card"
          edge="hairline"
          radius="lg"
          className="px-4 py-3 text-xs"
          role="status"
        >
          <Text bare tone="muted">
            {notice}
          </Text>
        </Surface>
      ) : null}
    </>
  );
}
