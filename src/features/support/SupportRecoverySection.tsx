import { clientMetadata } from "@/telemetry/metadata";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { Button, cn, Input, Textarea } from "@/shared/ui";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  PanelTopOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import {
  buildPublicFeedbackIssueUrl,
  type FeedbackDraft,
  type FeedbackKind,
} from "./feedbackIssue";
import { downloadSupportBundle } from "./supportBundle";
import {
  recoverLastClosedWorkspaceTab,
  reloadMisty,
  resetWorkspaceLayout,
} from "./recoveryActions";

const feedbackKinds: Array<{ id: FeedbackKind; label: string }> = [
  { id: "bug", label: "Something broke" },
  { id: "confusing", label: "Something was confusing" },
  { id: "idea", label: "I have an idea" },
  { id: "accessibility", label: "Accessibility" },
];

const initialDraft: FeedbackDraft = {
  kind: "bug",
  summary: "",
  area: "General",
  details: "",
  expected: "",
  frequency: "unknown",
};

const supportDisabledControlClass =
  "disabled:border-charcoal-border/80 disabled:bg-charcoal-bg disabled:text-cream-muted disabled:opacity-100 disabled:shadow-none";

export function SupportRecoverySection() {
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<"bundle" | "feedback" | "">("");
  const [resetArmed, setResetArmed] = useState(false);
  const [reloadArmed, setReloadArmed] = useState(false);

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

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium text-cream">
              What kind of feedback is it?
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {feedbackKinds.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left text-xs transition",
                    draft.kind === kind.id
                      ? "border-charcoal-active bg-charcoal-hover text-cream-bright"
                      : "border-charcoal-border bg-charcoal-bg text-cream-muted hover:text-cream",
                  )}
                  aria-pressed={draft.kind === kind.id}
                  onClick={() => updateDraft("kind", kind.id)}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FeedbackField label="Area">
              <select
                className={cn(
                  "h-9 rounded-md border border-charcoal-border bg-charcoal-bg px-3",
                  "text-sm text-cream outline-none focus:border-charcoal-active",
                  "focus:ring-2 focus:ring-charcoal-active/40",
                )}
                value={draft.area}
                onChange={(event) => updateDraft("area", event.target.value)}
              >
                {[
                  "General",
                  "Onboarding",
                  "Spaces",
                  "Journal",
                  "Planner",
                  "Social",
                  "Library",
                  "Files",
                  "Browser",
                  "Misty AI",
                  "Settings",
                ].map((area) => (
                  <option key={area}>{area}</option>
                ))}
              </select>
            </FeedbackField>
            <FeedbackField label="How often?">
              <select
                className={cn(
                  "h-9 rounded-md border border-charcoal-border bg-charcoal-bg px-3",
                  "text-sm text-cream outline-none focus:border-charcoal-active",
                  "focus:ring-2 focus:ring-charcoal-active/40",
                )}
                value={draft.frequency}
                onChange={(event) =>
                  updateDraft("frequency", event.target.value as FeedbackDraft["frequency"])
                }
              >
                <option value="unknown">Not sure</option>
                <option value="once">Once</option>
                <option value="sometimes">Sometimes</option>
                <option value="always">Every time</option>
              </select>
            </FeedbackField>
          </div>

          <FeedbackField label="Short summary" required>
            <Input
              required
              value={draft.summary}
              maxLength={120}
              placeholder="What went wrong or could be better?"
              onChange={(event) => updateDraft("summary", event.target.value)}
            />
          </FeedbackField>
          <FeedbackField label="What happened?" required>
            <Textarea
              required
              value={draft.details}
              maxLength={4_000}
              rows={5}
              placeholder="Tell us what you were doing and what you saw. Steps that reproduce a bug are especially useful."
              onChange={(event) => updateDraft("details", event.target.value)}
            />
          </FeedbackField>
          <FeedbackField label="What did you expect?">
            <Textarea
              value={draft.expected}
              maxLength={2_000}
              rows={3}
              placeholder="Describe the result that would have felt correct."
              onChange={(event) => updateDraft("expected", event.target.value)}
            />
          </FeedbackField>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-charcoal-border pt-5">
            <Button
              type="button"
              variant="outline"
              className={supportDisabledControlClass}
              disabled={Boolean(working)}
              onClick={() => void downloadDiagnostics()}
            >
              <Download className="size-4" />
              {working === "bundle" ? "Preparing…" : "Download diagnostics"}
            </Button>
            <Button
              type="button"
              className={supportDisabledControlClass}
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

function RecoveryAction(props: {
  icon: typeof RefreshCw;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  const Icon = props.icon;
  return (
    <div className="grid min-h-[76px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 bg-charcoal-card p-4 max-[680px]:grid-cols-[36px_minmax(0,1fr)]">
      <span className="grid size-9 place-items-center rounded-md bg-charcoal-bg text-cream-muted">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-medium text-cream">{props.title}</strong>
        <span className="mt-0.5 block text-xs leading-5 text-cream-muted">{props.detail}</span>
      </span>
      <Button
        className="min-w-32 max-[680px]:col-span-2 max-[680px]:w-full"
        type="button"
        variant={props.emphasized ? "default" : "outline"}
        onClick={props.onClick}
      >
        {props.action}
      </Button>
    </div>
  );
}

function FeedbackField(props: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="grid gap-2 text-xs font-medium text-cream">
      <span>
        {props.label}
        {props.required ? (
          <span className="ml-1 text-cream-muted" aria-hidden="true">
            (required)
          </span>
        ) : null}
      </span>
      {props.children}
    </label>
  );
}

function SupportSectionBlock(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 min-w-0 last:mb-0">
      <div className="mb-3 min-w-0">
        <h2 className="text-sm font-semibold leading-5 text-cream">{props.title}</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-[18px] text-cream-muted">
          {props.description}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-charcoal-border/80 bg-charcoal-card">
        {props.children}
      </div>
    </section>
  );
}
