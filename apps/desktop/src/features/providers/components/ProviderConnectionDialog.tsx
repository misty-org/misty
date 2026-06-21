import { openUrl } from "@tauri-apps/plugin-opener";
import type { ProviderWorkflow, ProviderWorkflowOption } from "../../../api/types";
import { iconAssets, providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import type { ProviderConnectionSession } from "../useProvidersStore";

interface ProviderConnectionDialogProps {
  session: ProviderConnectionSession;
  workflows: ProviderWorkflow[];
  onClose: () => void;
  onChooseProvider: (providerType: string) => void;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
  onAdvance: () => void;
  onSubmit: () => void;
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
    <div className="modal-backdrop" role="presentation">
      <section className="provider-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-connect-title">
        <header className="provider-connect-header">
          <div>
            <h2 id="provider-connect-title">{title}</h2>
            <p>{dialogSubtitle(session)}</p>
          </div>
          <button className="icon-button" type="button" onClick={props.onClose} disabled={session.inFlight} aria-label="Close">
            <AssetIcon src={iconAssets.x24} size={18} />
          </button>
        </header>

        <div className="provider-connect-progress" aria-label="Connection progress">
          <ProgressStep label="Provider" active={session.stage === "provider"} complete={session.stage !== "provider"} />
          <ProgressStep label="Configure" active={session.stage === "configure"} complete={session.stage === "authorize" || session.stage === "complete"} />
          <ProgressStep label="Connect" active={session.stage === "authorize"} complete={session.stage === "complete"} />
        </div>

        <div className="provider-connect-body">
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
            <div className="provider-authorize-state">
              <div className="provider-authorize-icon">
                <AssetIcon className={session.polling ? "spin" : ""} src={session.polling ? iconAssets.sync24 : iconAssets.rclone24} size={28} />
              </div>
              <h3>Finish signing in with your provider</h3>
              <p>{session.step?.instructions || "Misty opened the authorization page in your browser and is waiting for it to finish."}</p>
              {session.step?.authorizeUrl ? (
                <button className="provider-auth-link" type="button" onClick={() => void openUrl(session.step!.authorizeUrl)}>
                  <AssetIcon src={iconAssets.rclone24} size={15} /> Open authorization page
                </button>
              ) : null}
            </div>
          ) : null}

          {session.stage === "complete" ? (
            <div className="provider-authorize-state complete">
              <div className="provider-authorize-icon"><AssetIcon src={iconAssets.verified24} size={30} /></div>
              <h3>Remote connected</h3>
              <p><strong>{session.remoteName}</strong> is ready to use in Explorer.</p>
            </div>
          ) : null}

          {session.error ? <div className="provider-connect-error" role="alert">{session.error}</div> : null}
        </div>

        <footer className="provider-connect-actions">
          <button type="button" onClick={props.onClose} disabled={session.inFlight}>
            {session.stage === "complete" ? "Close" : "Cancel"}
          </button>
          {session.stage === "provider" ? (
            <button className="primary" type="button" onClick={props.onAdvance} disabled={!session.providerType}>
              Continue
            </button>
          ) : null}
          {session.stage === "configure" ? (
            <button className="primary" type="button" onClick={props.onSubmit} disabled={session.inFlight}>
              <AssetIcon className={session.inFlight ? "spin" : ""} src={session.inFlight ? iconAssets.sync16 : iconAssets.shieldLock24} size={16} />
              {submitLabel(session)}
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
  if (props.workflows.length === 0) {
    return <div className="empty">No provider workflows are available. Refresh Providers and check the proxy connection.</div>;
  }
  return (
    <div className="provider-workflow-grid">
      {props.workflows.map((workflow) => (
        <ProviderWorkflowButton
          key={workflow.type}
          workflow={workflow}
          selected={props.selected === workflow.type}
          onSelect={() => props.onSelect(workflow.type)}
        />
      ))}
    </div>
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
      className={props.selected ? "selected" : ""}
      onClick={props.onSelect}
    >
      <span className="provider-workflow-mark">
        <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
      </span>
      <span>
        <strong>{props.workflow.name || props.workflow.type}</strong>
        <small>{props.workflow.description || props.workflow.type}</small>
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
  const stepOption = props.session.step?.option;
  const options = stepOption ? [stepOption] : props.workflow?.options ?? [];
  return (
    <div className="provider-connect-form">
      <label>
        Remote name
        <input
          value={props.session.remoteName}
          onChange={(event) => props.onName(event.target.value)}
          readOnly={props.session.mode !== "add"}
          autoFocus={props.session.mode === "add"}
        />
        <small>Used in Explorer and rclone paths.</small>
      </label>
      <div className="provider-connect-summary">
        <span>Provider</span>
        <strong>{props.workflow?.name || props.session.providerType}</strong>
      </div>
      {options.map((option) => (
        <ProviderOptionField
          key={option.name}
          option={option}
          value={props.session.parameters[option.name] ?? ""}
          onChange={(value) => props.onParameter(option.name, value)}
        />
      ))}
      {props.session.step?.instructions ? <p className="provider-instructions">{props.session.step.instructions}</p> : null}
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
        <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
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
      {option.help ? <small>{option.help}</small> : null}
    </label>
  );
}

function ProgressStep(props: { label: string; active: boolean; complete: boolean }) {
  return (
    <div className={`${props.active ? "active" : ""}${props.complete ? " complete" : ""}`}>
      <span>{props.complete ? <AssetIcon src={iconAssets.verified24} size={12} /> : null}</span>
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
