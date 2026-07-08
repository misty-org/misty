import type { ProviderWorkflow, ProviderWorkflowOption, RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { iconAssets } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { prettyLabel } from "../../../shared/format";
import { isSecretKey, parseTokenFields } from "../providerUtils";

interface RemoteConfigFormProps {
  draft: RemoteEditDraft;
  configKeys: string[];
  workflow: ProviderWorkflow | null;
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}

const remoteConfigFormClass =
  "min-h-0";

const formGridClass =
  "grid max-w-[760px] grid-cols-2 gap-x-4 gap-y-3.5 p-[18px] max-[980px]:grid-cols-1";

const labelClass =
  "grid gap-1.5 text-[var(--misty-text-muted)] capitalize";

const inputClass =
  "w-full min-w-0 rounded-lg border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] px-2.5 py-[9px] text-[var(--misty-text)]";

const secretFieldClass =
  "grid grid-cols-[minmax(0,1fr)_34px] items-center overflow-hidden rounded-lg border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] focus-within:border-[var(--misty-accent)]";

const secretInputClass =
  "min-h-[38px] border-0 bg-transparent px-2.5 py-[9px] text-[var(--misty-text)] outline-none";

const secretToggleClass =
  "grid h-[34px] w-[34px] place-items-center border-0 bg-transparent text-[var(--misty-text-subtle)] hover:text-[var(--misty-text)]";

const tokenFieldsClass =
  "col-span-full m-0 grid grid-cols-2 gap-x-4 gap-y-3.5 border border-[var(--misty-border-soft)] p-3.5 max-[980px]:grid-cols-1";

const tokenLegendClass =
  "flex items-center gap-2.5 px-2 text-[var(--misty-text)]";

const tokenToggleClass =
  "grid h-7 w-7 place-items-center rounded-md border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] text-[var(--misty-accent)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))]";

const pathsPanelClass =
  "mx-[18px] mb-3.5 grid max-w-[760px] gap-1.5 border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] p-3 text-[var(--misty-text-muted)] [overflow-wrap:anywhere]";

export function RemoteConfigForm(props: RemoteConfigFormProps) {
  const {
    draft,
    configKeys,
    workflow,
    configPaths,
    tokenVisible,
    onDraftName,
    onConfigField,
    onTokenField,
    onTokenVisible,
  } = props;

  return (
    <div className={remoteConfigFormClass}>
      <div className={formGridClass}>
        <label className={labelClass}>
          Name
          <input className={inputClass} value={draft.name} onChange={(event) => onDraftName(event.target.value)} />
        </label>
        <label className={labelClass}>
          Type
          <input className={inputClass} value={draft.providerType || draft.config.type || ""} readOnly />
        </label>

        {configKeys.map((key) => (
          <ConfigField
            key={key}
            configKey={key}
            option={workflowOptionForKey(workflow, key)}
            value={draft.config[key] ?? ""}
            tokenVisible={tokenVisible}
            onConfigField={onConfigField}
            onTokenField={onTokenField}
            onTokenVisible={onTokenVisible}
          />
        ))}
      </div>

      {configPaths ? (
        <div className={pathsPanelClass}>
          <div>Config: {configPaths.configPath ?? "--"}</div>
          <div>Cache: {configPaths.cachePath ?? "--"}</div>
          <div>Temp: {configPaths.tempPath ?? "--"}</div>
        </div>
      ) : null}
    </div>
  );
}

function ConfigField(props: {
  configKey: string;
  option: ProviderWorkflowOption | null;
  value: string;
  tokenVisible: boolean;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}) {
  const { configKey, option, value, tokenVisible, onConfigField, onTokenField, onTokenVisible } = props;

  if (configKey === "token") {
    const fields = parseTokenFields(value);
    if (fields.length > 0) {
      return (
        <fieldset className={tokenFieldsClass}>
          <legend className={tokenLegendClass}>
            Authentication
            <button
              className={tokenToggleClass}
              type="button"
              title={tokenVisible ? "Hide sensitive values" : "Show sensitive values"}
              aria-label={tokenVisible ? "Hide sensitive values" : "Show sensitive values"}
              aria-pressed={tokenVisible}
              onClick={() => onTokenVisible(!tokenVisible)}
            >
              <AssetIcon src={tokenVisible ? iconAssets.eyeClosed16 : iconAssets.eye16} size={16} />
            </button>
          </legend>
          {fields.map((field) => (
            <label className={labelClass} key={field.key}>
              {prettyLabel(field.key)}
              <input
                className={inputClass}
                value={field.value}
                type={field.sensitive && !tokenVisible ? "password" : "text"}
                onChange={(event) => onTokenField(field.key, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
      );
    }
  }

  return (
    <label className={labelClass}>
      {option?.label || prettyLabel(configKey)}
      {option && option.choices.length > 0 ? (
        <select
          className={inputClass}
          value={value}
          onChange={(event) => onConfigField(configKey, event.target.value)}
        >
          {value && !option.choices.some((choice) => choice.value === value) ? (
            <option value={value}>{value}</option>
          ) : null}
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.help || choice.value}</option>
          ))}
        </select>
      ) : (
        <SecretConfigInput
          value={value}
          sensitive={Boolean(option?.password) || isSecretKey(configKey)}
          visible={tokenVisible}
          onChange={(nextValue) => onConfigField(configKey, nextValue)}
          onVisible={onTokenVisible}
        />
      )}
      {option?.help ? <small className="text-xs normal-case leading-[1.35] text-[var(--misty-text-subtle)]">{option.help}</small> : null}
    </label>
  );
}

function SecretConfigInput(props: {
  value: string;
  sensitive: boolean;
  visible: boolean;
  onChange: (value: string) => void;
  onVisible: (visible: boolean) => void;
}) {
  if (!props.sensitive) {
    return (
      <input
        className={inputClass}
        value={props.value}
        type="text"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <span className={secretFieldClass}>
      <input
        className={secretInputClass}
        value={props.value}
        type={props.visible ? "text" : "password"}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        className={secretToggleClass}
        type="button"
        title={props.visible ? "Hide sensitive value" : "Show sensitive value"}
        aria-label={props.visible ? "Hide sensitive value" : "Show sensitive value"}
        aria-pressed={props.visible}
        onClick={() => props.onVisible(!props.visible)}
      >
        <AssetIcon src={props.visible ? iconAssets.eyeClosed16 : iconAssets.eye16} size={16} />
      </button>
    </span>
  );
}

function workflowOptionForKey(workflow: ProviderWorkflow | null, key: string): ProviderWorkflowOption | null {
  return workflow?.options.find((option) => option.name === key) ?? null;
}
