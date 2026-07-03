import type { RcloneConfigPaths, RemoteEditDraft } from "../../../api/types";
import { prettyLabel } from "../../../shared/format";
import { isSecretKey, parseTokenFields } from "../providerUtils";

interface RemoteConfigFormProps {
  draft: RemoteEditDraft;
  configKeys: string[];
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}

const remoteConfigFormClass =
  "min-h-0 overflow-auto";

const formGridClass =
  "grid max-w-[760px] grid-cols-2 gap-x-4 gap-y-3.5 p-[18px] max-[980px]:grid-cols-1";

const labelClass =
  "grid gap-1.5 text-[var(--misty-text-muted)] capitalize";

const inputClass =
  "w-full min-w-0 rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 py-[9px] text-[var(--misty-text)]";

const tokenFieldsClass =
  "col-span-full m-0 grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-[10px] border border-[var(--misty-border-soft)] p-3.5 max-[980px]:grid-cols-1";

const tokenLegendClass =
  "flex items-center gap-2.5 px-2 text-[var(--misty-text)]";

const tokenToggleClass =
  "rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-[9px] py-[3px] text-[var(--misty-accent)]";

const pathsPanelClass =
  "mx-[18px] mb-3.5 grid max-w-[760px] gap-1.5 [overflow-wrap:anywhere] rounded-[10px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-3 text-[var(--misty-text-muted)]";

export function RemoteConfigForm(props: RemoteConfigFormProps) {
  const {
    draft,
    configKeys,
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
  value: string;
  tokenVisible: boolean;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}) {
  const { configKey, value, tokenVisible, onConfigField, onTokenField, onTokenVisible } = props;

  if (configKey === "token") {
    const fields = parseTokenFields(value);
    if (fields.length > 0) {
      return (
        <fieldset className={tokenFieldsClass}>
          <legend className={tokenLegendClass}>
            Authentication
            <button className={tokenToggleClass} type="button" onClick={() => onTokenVisible(!tokenVisible)}>
              {tokenVisible ? "Hide" : "Show"}
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
      {prettyLabel(configKey)}
      <input
        className={inputClass}
        value={value}
        type={isSecretKey(configKey) ? "password" : "text"}
        onChange={(event) => onConfigField(configKey, event.target.value)}
      />
    </label>
  );
}
