import type { ProviderWorkflow, ProviderWorkflowOption } from "@/native/contracts";
import { iconAssets } from "@/shared/assets/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AssetIcon,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { useEffect, useMemo, useState } from "react";
import type { ProviderConnectionSession } from "../model/stores/providers/interfaces/useProvidersStore";
import { providerOptionsForConnection } from "../providerUtils";
import { ProviderLogo } from "./ProviderLogo";

const providerDialogClass =
  "flex max-h-[min(760px,calc(100vh-48px))] w-[min(560px,calc(100vw-48px))] max-w-none flex-col overflow-hidden bg-charcoal-card p-0";

const providerHeaderClass =
  "flex grid-cols-[1fr_auto] items-start justify-between gap-5 border-b border-charcoal-border px-5 py-[18px] text-left";

const providerProgressClass =
  "grid grid-cols-3 border-b border-charcoal-border bg-charcoal-card px-5 py-[11px]";

const providerBodyClass = "min-h-[280px] overflow-auto p-5";

const providerFooterClass =
  "mt-0 flex-row justify-end gap-[9px] border-t border-charcoal-border px-5 py-3.5";

const providerWorkflowGridClass = "grid grid-cols-2 gap-2.5";

const providerSearchClass = "mb-3 grid gap-2 rounded-md bg-charcoal-card p-3";

const providerWorkflowButtonClass =
  "grid h-auto min-w-0 grid-cols-[38px_minmax(0,1fr)_18px] items-center justify-start gap-[11px] rounded-lg p-3 text-left";

const providerWorkflowButtonSelectedClass = "border-charcoal-active bg-charcoal-active";

const providerWorkflowMarkClass = "grid h-[38px] w-[38px] place-items-center text-cream-bright";

const providerFormClass = "mx-auto grid max-w-[520px] gap-3.5";

const providerFieldClass = "grid gap-2 text-[13px] font-semibold text-cream-muted";

const providerFormHelpClass = "text-[11px] font-medium normal-case text-cream-muted";

const providerSummaryClass =
  "flex items-center justify-between rounded-md bg-charcoal-card px-3 py-2.5 text-cream-muted";

const providerInstructionsClass =
  "border-l-2 border-charcoal-active pl-[11px] text-[13px] text-cream";

const providerAuthorizeStateClass =
  "mx-auto my-[30px] grid max-w-[430px] justify-items-center gap-2.5 text-center";

const providerAuthorizeIconClass =
  "grid h-[58px] w-[58px] place-items-center rounded-full border border-charcoal-active/30 bg-charcoal-active text-cream-bright";

const providerAuthorizeCompleteIconClass = "border-charcoal-border bg-charcoal-hover text-sage-fg";

const EMPTY_SELECT_VALUE = "__misty_empty__";

export function ProviderConnectionDialog(props: ProviderConnectionDialogProps) {
  const { session } = props;
  const workflow = workflowForType(props.workflows, session.providerType);
  const title = session.mode === "add" ? "Add Remote" : "Configure Remote";

  useEffect(() => {
    if (session.stage !== "authorize" || session.inFlight) return;
    const checkAuthorization = () => {
      if (document.visibilityState === "hidden") return;
      props.onSubmit(true);
    };
    window.addEventListener("focus", checkAuthorization);
    document.addEventListener("visibilitychange", checkAuthorization);
    return () => {
      window.removeEventListener("focus", checkAuthorization);
      document.removeEventListener("visibilitychange", checkAuthorization);
    };
  }, [props, session.inFlight, session.stage]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className={`${providerDialogClass} [&>button:last-child]:hidden`}>
        <DialogHeader className={providerHeaderClass}>
          <div>
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription className="text-[13px]">{dialogSubtitle(session)}</DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={props.onClose}
            aria-label="Close"
          >
            <AssetIcon src={iconAssets.x24} size={18} />
          </Button>
        </DialogHeader>

        <div className={providerProgressClass} aria-label="Connection progress">
          <ProgressStep
            label="Provider"
            active={session.stage === "provider"}
            complete={session.stage !== "provider"}
          />
          <ProgressStep
            label="Configure"
            active={session.stage === "configure"}
            complete={session.stage === "authorize" || session.stage === "complete"}
          />
          <ProgressStep
            label="Connect"
            active={session.stage === "authorize"}
            complete={session.stage === "complete"}
          />
        </div>

        <div className={providerBodyClass}>
          {session.stage === "provider" ? (
            <ProviderPicker
              workflows={props.workflows}
              selected={session.providerType}
              onSelect={props.onChooseProvider}
            />
          ) : null}

          {session.stage === "configure" ? (
            <ProviderConfiguration
              session={session}
              workflow={workflow}
              onName={props.onName}
              onParameter={props.onParameter}
            />
          ) : null}

          {session.stage === "authorize" ? (
            <div className={providerAuthorizeStateClass}>
              <div className={providerAuthorizeIconClass}>
                <AssetIcon
                  className={session.polling ? "animate-spin" : ""}
                  src={session.polling ? iconAssets.sync24 : iconAssets.cloud24}
                  size={28}
                />
              </div>
              <h3 className="m-0">Finish signing in with your provider</h3>
              <p className="leading-[1.55]">
                {session.step?.instructions ||
                  "Misty opened the authorization page in your browser and is waiting for it to finish."}
              </p>
              <small className="text-cream-muted">
                {session.polling
                  ? `Checking authorization${session.authPollAttempts > 0 ? ` (${session.authPollAttempts})` : ""}...`
                  : "Return here after the browser sign-in completes."}
              </small>
              {session.step?.authorizeUrl ? (
                <Button variant="link" type="button" onClick={props.onOpenAuthorize}>
                  <AssetIcon src={iconAssets.cloud24} size={15} />{" "}
                  {session.openedAuthorizeUrl
                    ? "Reopen authorization page"
                    : "Open authorization page"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {session.stage === "complete" ? (
            <div className={providerAuthorizeStateClass}>
              <div
                className={`${providerAuthorizeIconClass} ${providerAuthorizeCompleteIconClass}`}
              >
                <AssetIcon src={iconAssets.verified24} size={30} />
              </div>
              <h3 className="m-0">Remote connected</h3>
              <p className="leading-[1.55]">
                <strong>{session.remoteName}</strong> is ready to use in Files.
              </p>
            </div>
          ) : null}

          {session.error ? (
            <Alert variant="destructive" className="mt-3.5">
              <AlertTitle>Connection error</AlertTitle>
              <AlertDescription>{session.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className={providerFooterClass}>
          <Button variant="ghost" type="button" onClick={props.onClose}>
            {session.stage === "complete" ? "Close" : "Cancel"}
          </Button>
          {session.stage === "provider" ? (
            <Button type="button" onClick={props.onAdvance} disabled={!session.providerType}>
              Continue
            </Button>
          ) : null}
          {session.stage === "configure" ? (
            <Button type="button" onClick={() => props.onSubmit(false)} disabled={session.inFlight}>
              <AssetIcon
                className={session.inFlight ? "animate-spin" : ""}
                src={session.inFlight ? iconAssets.sync16 : iconAssets.shieldLock24}
                size={16}
              />
              {submitLabel(session)}
            </Button>
          ) : null}
          {session.stage === "authorize" ? (
            <Button type="button" onClick={() => props.onSubmit(true)} disabled={session.inFlight}>
              <AssetIcon
                className={session.inFlight ? "animate-spin" : ""}
                src={session.inFlight ? iconAssets.sync16 : iconAssets.shieldLock24}
                size={16}
              />
              {session.inFlight ? "Checking..." : "Check Again"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderPicker(props: {
  workflows: ProviderWorkflow[];
  selected: string;
  onSelect: (providerType: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredWorkflows = useMemo(
    () => filterProviderWorkflows(props.workflows, query),
    [props.workflows, query],
  );
  if (props.workflows.length === 0) {
    return (
      <EmptyState
        compact
        title="No cloud providers available"
        description="Refresh Remotes and check the remote service connection."
      />
    );
  }
  return (
    <>
      <label className={providerSearchClass}>
        <span className="flex items-center justify-between gap-3 text-xs text-cream-muted">
          <strong className="text-cream">Provider backend</strong>
          <span>
            {filteredWorkflows.length} of {props.workflows.length}
          </span>
        </span>
        <Input
          value={query}
          placeholder="Search cloud providers..."
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {filteredWorkflows.length > 0 ? (
        <div className={providerWorkflowGridClass}>
          {filteredWorkflows.map((workflow) => (
            <ProviderWorkflowButton
              key={workflow.type}
              workflow={workflow}
              selected={props.selected === workflow.type}
              onSelect={() => props.onSelect(workflow.type)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          title="No matching providers"
          description="Try a different provider name or backend."
        />
      )}
    </>
  );
}

function filterProviderWorkflows(workflows: ProviderWorkflow[], query: string): ProviderWorkflow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return workflows;
  return workflows.filter((workflow) =>
    [workflow.type, workflow.name, workflow.description].join("\n").toLowerCase().includes(needle),
  );
}

function ProviderWorkflowButton(props: {
  workflow: ProviderWorkflow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="outline"
      type="button"
      className={`${providerWorkflowButtonClass} ${props.selected ? providerWorkflowButtonSelectedClass : ""}`}
      onClick={props.onSelect}
    >
      <span className={providerWorkflowMarkClass}>
        <ProviderLogo type={props.workflow.type} size={23} />
      </span>
      <span>
        <strong className="block overflow-hidden text-ellipsis">
          {props.workflow.name || props.workflow.type}
        </strong>
        <small className="mt-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-cream-muted">
          {props.workflow.description || props.workflow.type}
        </small>
      </span>
      {props.selected ? <AssetIcon src={iconAssets.verified24} size={17} /> : null}
    </Button>
  );
}

function ProviderConfiguration(props: {
  session: ProviderConnectionSession;
  workflow: ProviderWorkflow | null;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
}) {
  const options = providerOptionsForConnection(props.session, props.workflow);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  return (
    <div className={providerFormClass}>
      <label className={providerFieldClass}>
        Remote name
        <Input
          className="h-11"
          value={props.session.remoteName}
          onChange={(event) => props.onName(event.target.value)}
          autoFocus={props.session.mode === "add"}
        />
        <small className={providerFormHelpClass}>Used to identify this connection in Files.</small>
      </label>
      <div className={providerSummaryClass}>
        <span>Provider</span>
        <strong className="text-cream">{props.workflow?.name || props.session.providerType}</strong>
      </div>
      {options.map((option) => (
        <ProviderOptionField
          key={option.name}
          option={option}
          value={props.session.parameters[option.name] ?? ""}
          sensitiveVisible={sensitiveVisible}
          onChange={(value) => props.onParameter(option.name, value)}
          onSensitiveVisible={setSensitiveVisible}
        />
      ))}
      {props.session.step?.instructions ? (
        <p className={providerInstructionsClass}>{props.session.step.instructions}</p>
      ) : null}
    </div>
  );
}

function ProviderOptionField(props: {
  option: ProviderWorkflowOption;
  value: string;
  sensitiveVisible: boolean;
  onChange: (value: string) => void;
  onSensitiveVisible: (visible: boolean) => void;
}) {
  const { option } = props;
  const secret = option.password || isSensitiveOptionName(option.name);
  return (
    <label className={providerFieldClass}>
      {option.label || option.name}
      {option.required ? " *" : ""}
      {option.choices.length > 0 ? (
        <Select
          value={props.value || EMPTY_SELECT_VALUE}
          onValueChange={(nextValue) =>
            props.onChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
          }
        >
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {option.choices.map((choice) => (
              <SelectItem
                key={choice.value || EMPTY_SELECT_VALUE}
                value={choice.value || EMPTY_SELECT_VALUE}
              >
                {choice.help || choice.value || "None"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span
          className={secret ? "grid grid-cols-[minmax(0,1fr)_42px] items-center gap-1" : "grid"}
        >
          <Input
            className="h-11"
            value={props.value}
            type={secret && !props.sensitiveVisible ? "password" : "text"}
            onChange={(event) => props.onChange(event.target.value)}
          />
          {secret ? (
            <Button
              variant="outline"
              size="icon"
              className="h-11"
              type="button"
              title={props.sensitiveVisible ? "Hide sensitive value" : "Show sensitive value"}
              aria-label={props.sensitiveVisible ? "Hide sensitive value" : "Show sensitive value"}
              aria-pressed={props.sensitiveVisible}
              onClick={() => props.onSensitiveVisible(!props.sensitiveVisible)}
            >
              <AssetIcon
                src={props.sensitiveVisible ? iconAssets.eyeClosed16 : iconAssets.eye16}
                size={16}
              />
            </Button>
          ) : null}
        </span>
      )}
      {option.help ? <small className={providerFormHelpClass}>{option.help}</small> : null}
    </label>
  );
}

function ProgressStep(props: { label: string; active: boolean; complete: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-[7px] text-xs ${props.active || props.complete ? "text-cream" : "text-cream-muted"}`}
    >
      <span
        className={`block h-[12px] w-[12px] shrink-0 rounded-full ${
          props.complete || props.active
            ? props.complete
              ? "bg-status-green"
              : "bg-charcoal-active"
            : "border border-charcoal-border bg-transparent"
        }`}
      />
      {props.label}
    </div>
  );
}

function isSensitiveOptionName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("secret") || normalized.includes("password") || normalized.includes("token")
  );
}

function workflowForType(workflows: ProviderWorkflow[], type: string): ProviderWorkflow | null {
  return workflows.find((workflow) => workflow.type === type) ?? null;
}

function dialogSubtitle(session: ProviderConnectionSession): string {
  if (session.mode === "repair") return "Run provider setup again without replacing the remote.";
  return "Choose a provider and complete its secure sign-in flow.";
}

function submitLabel(session: ProviderConnectionSession): string {
  if (session.inFlight) return session.step ? "Continuing…" : "Starting…";
  if (session.step) return "Continue";
  if (session.mode === "repair") return "Configure";
  return "Connect Remote";
}

export interface ProviderConnectionDialogProps {
  session: ProviderConnectionSession;
  workflows: ProviderWorkflow[];
  onClose: () => void;
  onChooseProvider: (providerType: string) => void;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
  onAdvance: () => void;
  onSubmit: (polling?: boolean) => void;
  onOpenAuthorize: () => void;
}
