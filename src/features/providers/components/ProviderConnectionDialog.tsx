import { useMemo, useState } from "react";
import type { ProviderWorkflow, ProviderWorkflowOption } from "../../../api/types";
import { iconAssets, providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { providerOptionsForConnection } from "../providerUtils";
import type { ProviderConnectionSession } from "../useProvidersStore";

const modalBackdropClass =
  "fixed inset-0 z-[100] grid place-items-center bg-[rgba(3,7,10,0.72)] p-6";

const providerDialogClass =
  "flex max-h-[min(760px,calc(100vh-48px))] w-[min(620px,calc(100vw-48px))] flex-col overflow-hidden rounded-[10px] border border-[#35434e] bg-[#0d141a] shadow-[0_28px_90px_rgba(0,0,0,0.58)]";

const providerHeaderClass =
  "flex items-start justify-between gap-5 border-b border-[#25313a] px-5 py-[18px]";

const providerCloseButtonClass =
  "grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-text)] disabled:opacity-55";

const providerProgressClass =
  "grid grid-cols-3 border-b border-[#25313a] bg-[#0a1015] px-5 py-[11px]";

const providerBodyClass =
  "min-h-[280px] overflow-auto p-5";

const providerFooterClass =
  "flex justify-end gap-[9px] border-t border-[#25313a] px-5 py-3.5";

const providerFooterButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-[7px] rounded-[7px] border border-[#35414b] bg-[#141c23] px-3.5 py-2 text-[#e8eaed] disabled:opacity-55";

const providerPrimaryButtonClass =
  `${providerFooterButtonClass} border-[#2879d5] bg-[#176fd1] text-white`;

const providerWorkflowGridClass =
  "grid grid-cols-2 gap-2.5";

const providerSearchClass =
  "mb-3 grid gap-2 rounded-lg border border-[#25313a] bg-[#0a1117] p-3";

const providerSearchInputClass =
  "h-9 rounded-[7px] border border-[#303a44] bg-[#080d11] px-2.5 text-[#f0eee9] outline-none placeholder:text-[#66717d] focus:border-[#4779ae]";

const providerWorkflowButtonClass =
  "grid min-w-0 grid-cols-[38px_minmax(0,1fr)_18px] items-center gap-[11px] rounded-lg border border-[#2e3943] bg-[#101820] p-3 text-left text-[#eef0f2] hover:border-[#4779ae] hover:bg-[#142536]";

const providerWorkflowButtonSelectedClass =
  "border-[#4779ae] bg-[#142536]";

const providerWorkflowMarkClass =
  "grid h-[38px] w-[38px] place-items-center rounded-[7px] bg-[#203549] font-bold text-[#9dcaff]";

const providerFormClass =
  "mx-auto grid max-w-[560px] gap-3.5";

const providerFormHelpClass =
  "text-[11px] normal-case text-[#78838f]";

const providerSelectClass =
  "w-full rounded-[7px] border border-[#303a44] bg-[#080d11] px-2.5 py-[9px] text-[#f0eee9]";

const providerSummaryClass =
  "flex items-center justify-between rounded-[7px] border border-[#25313a] bg-[#0a1117] px-3 py-2.5 text-[#8f98a4]";

const providerInstructionsClass =
  "border-l-2 border-[#4779ae] pl-[11px] text-[13px]";

const providerAuthorizeStateClass =
  "mx-auto my-[30px] grid max-w-[430px] justify-items-center gap-2.5 text-center";

const providerAuthorizeIconClass =
  "grid h-[58px] w-[58px] place-items-center rounded-full border border-[#335578] bg-[#132538] text-[#91c5ff]";

const providerAuthorizeCompleteIconClass =
  "border-[#397c55] bg-[#163424] text-[#91daa3]";

const providerAuthLinkClass =
  "inline-flex items-center gap-[7px] border-0 bg-transparent p-[5px] text-[#87bfff]";

const providerErrorClass =
  "mt-3.5 rounded-[7px] border border-[#6c363d] bg-[#251217] px-3 py-2.5 text-[13px] text-[#efa1a7]";

interface ProviderConnectionDialogProps {
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

export function ProviderConnectionDialog(props: ProviderConnectionDialogProps) {
  const { session } = props;
  const workflow = workflowForType(props.workflows, session.providerType);
  const title = session.mode === "add"
    ? "Add Remote"
    : session.mode === "reconnect"
      ? "Reconnect Remote"
      : "Configure Remote";

  return (
    <div className={modalBackdropClass} role="presentation">
      <section className={providerDialogClass} role="dialog" aria-modal="true" aria-labelledby="provider-connect-title">
        <header className={providerHeaderClass}>
          <div>
            <h2 className="text-xl" id="provider-connect-title">{title}</h2>
            <p className="text-[13px]">{dialogSubtitle(session)}</p>
          </div>
          <button className={providerCloseButtonClass} type="button" onClick={props.onClose} disabled={session.inFlight} aria-label="Close">
            <AssetIcon src={iconAssets.x24} size={18} />
          </button>
        </header>

        <div className={providerProgressClass} aria-label="Connection progress">
          <ProgressStep label="Provider" active={session.stage === "provider"} complete={session.stage !== "provider"} />
          <ProgressStep label="Configure" active={session.stage === "configure"} complete={session.stage === "authorize" || session.stage === "complete"} />
          <ProgressStep label="Connect" active={session.stage === "authorize"} complete={session.stage === "complete"} />
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
                <AssetIcon className={session.polling ? "animate-spin" : ""} src={session.polling ? iconAssets.sync24 : iconAssets.rclone24} size={28} />
              </div>
              <h3 className="m-0">Finish signing in with your provider</h3>
              <p className="leading-[1.55]">{session.step?.instructions || "Misty opened the authorization page in your browser and is waiting for it to finish."}</p>
              <small className="text-[var(--misty-text-subtle)]">
                {session.polling
                  ? `Checking authorization${session.authPollAttempts > 0 ? ` (${session.authPollAttempts})` : ""}...`
                  : "Return here after the browser sign-in completes."}
              </small>
              {session.step?.authorizeUrl ? (
                <button className={providerAuthLinkClass} type="button" onClick={props.onOpenAuthorize}>
                  <AssetIcon src={iconAssets.rclone24} size={15} /> {session.openedAuthorizeUrl ? "Reopen authorization page" : "Open authorization page"}
                </button>
              ) : null}
            </div>
          ) : null}

          {session.stage === "complete" ? (
            <div className={providerAuthorizeStateClass}>
              <div className={`${providerAuthorizeIconClass} ${providerAuthorizeCompleteIconClass}`}><AssetIcon src={iconAssets.verified24} size={30} /></div>
              <h3 className="m-0">Remote connected</h3>
              <p className="leading-[1.55]"><strong>{session.remoteName}</strong> is ready to use in Explorer.</p>
            </div>
          ) : null}

          {session.error ? <div className={providerErrorClass} role="alert">{session.error}</div> : null}
        </div>

        <footer className={providerFooterClass}>
          <button className={providerFooterButtonClass} type="button" onClick={props.onClose} disabled={session.inFlight}>
            {session.stage === "complete" ? "Close" : "Cancel"}
          </button>
          {session.stage === "provider" ? (
            <button className={providerPrimaryButtonClass} type="button" onClick={props.onAdvance} disabled={!session.providerType}>
              Continue
            </button>
          ) : null}
          {session.stage === "configure" ? (
            <button className={providerPrimaryButtonClass} type="button" onClick={() => props.onSubmit(false)} disabled={session.inFlight}>
              <AssetIcon className={session.inFlight ? "animate-spin" : ""} src={session.inFlight ? iconAssets.sync16 : iconAssets.shieldLock24} size={16} />
              {submitLabel(session)}
            </button>
          ) : null}
          {session.stage === "authorize" ? (
            <button className={providerPrimaryButtonClass} type="button" onClick={() => props.onSubmit(true)} disabled={session.inFlight}>
              <AssetIcon className={session.inFlight ? "animate-spin" : ""} src={session.inFlight ? iconAssets.sync16 : iconAssets.shieldLock24} size={16} />
              {session.inFlight ? "Checking..." : "Check Again"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
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
    return <div className="m-[18px] text-[var(--misty-text-muted)]">No remote workflows are available. Refresh Remotes and check the remote service connection.</div>;
  }
  return (
    <>
      <label className={providerSearchClass}>
        <span className="flex items-center justify-between gap-3 text-xs text-[#8f98a4]">
          <strong className="text-[#dce1e6]">Provider backend</strong>
          <span>{filteredWorkflows.length} of {props.workflows.length}</span>
        </span>
        <input
          className={providerSearchInputClass}
          value={query}
          placeholder="Search rclone backends..."
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
        <div className="rounded-lg border border-dashed border-[#2e3943] p-5 text-center text-sm text-[#8f98a4]">
          No rclone backends match this search.
        </div>
      )}
    </>
  );
}

function filterProviderWorkflows(workflows: ProviderWorkflow[], query: string): ProviderWorkflow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return workflows;
  return workflows.filter((workflow) =>
    [workflow.type, workflow.name, workflow.description]
      .join("\n")
      .toLowerCase()
      .includes(needle)
  );
}

function ProviderWorkflowButton(props: {
  workflow: ProviderWorkflow;
  selected: boolean;
  onSelect: () => void;
}) {
  const providerIcon = providerIconForType(props.workflow.type);
  return (
    <button
      type="button"
      className={`${providerWorkflowButtonClass} ${props.selected ? providerWorkflowButtonSelectedClass : ""}`}
      onClick={props.onSelect}
    >
      <span className={providerWorkflowMarkClass}>
        <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
      </span>
      <span>
        <strong className="block overflow-hidden text-ellipsis">{props.workflow.name || props.workflow.type}</strong>
        <small className="mt-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#8f98a4]">{props.workflow.description || props.workflow.type}</small>
      </span>
      {props.selected ? <AssetIcon src={iconAssets.verified24} size={17} /> : null}
    </button>
  );
}

function ProviderConfiguration(props: {
  session: ProviderConnectionSession;
  workflow: ProviderWorkflow | null;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
}) {
  const options = providerOptionsForConnection(props.session, props.workflow);
  return (
    <div className={providerFormClass}>
      <label>
        Remote name
        <input
          value={props.session.remoteName}
          onChange={(event) => props.onName(event.target.value)}
          readOnly={props.session.mode !== "add"}
          autoFocus={props.session.mode === "add"}
        />
        <small className={providerFormHelpClass}>Used in Explorer and rclone paths.</small>
      </label>
      <div className={providerSummaryClass}>
        <span>Provider</span>
        <strong className="text-[#e8eaed]">{props.workflow?.name || props.session.providerType}</strong>
      </div>
      {options.map((option) => (
        <ProviderOptionField
          key={option.name}
          option={option}
          value={props.session.parameters[option.name] ?? ""}
          onChange={(value) => props.onParameter(option.name, value)}
        />
      ))}
      {props.session.step?.instructions ? <p className={providerInstructionsClass}>{props.session.step.instructions}</p> : null}
    </div>
  );
}

function ProviderOptionField(props: {
  option: ProviderWorkflowOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const { option } = props;
  return (
    <label>
      {option.label || option.name}{option.required ? " *" : ""}
      {option.choices.length > 0 ? (
        <select className={providerSelectClass} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.help || choice.value}</option>
          ))}
        </select>
      ) : (
        <input
          value={props.value}
          type={option.password ? "password" : "text"}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {option.help ? <small className={providerFormHelpClass}>{option.help}</small> : null}
    </label>
  );
}

function ProgressStep(props: { label: string; active: boolean; complete: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-[7px] text-xs ${props.active || props.complete ? "text-[#dce1e6]" : "text-[#707985]"}`}>
      <span className={`grid h-[18px] w-[18px] place-items-center rounded-full border ${
        props.complete
          ? "border-[#397c55] bg-[#245b3a] text-[#9be0ac]"
          : props.active
            ? "border-[#4e90e5] shadow-[inset_0_0_0_4px_#176fd1]"
            : "border-[#3a4650]"
      }`}>{props.complete ? <AssetIcon src={iconAssets.verified24} size={12} /> : null}</span>
      {props.label}
    </div>
  );
}

function workflowForType(workflows: ProviderWorkflow[], type: string): ProviderWorkflow | null {
  return workflows.find((workflow) => workflow.type === type) ?? null;
}

function dialogSubtitle(session: ProviderConnectionSession): string {
  if (session.mode === "reconnect") return "Refresh the saved authorization for this remote.";
  if (session.mode === "repair") return "Run provider setup again without replacing the remote.";
  return "Choose a provider and complete its secure sign-in flow.";
}

function submitLabel(session: ProviderConnectionSession): string {
  if (session.inFlight) return session.step ? "Continuing…" : "Starting…";
  if (session.step) return "Continue";
  if (session.mode === "reconnect") return "Reconnect";
  if (session.mode === "repair") return "Configure";
  return "Connect Remote";
}
