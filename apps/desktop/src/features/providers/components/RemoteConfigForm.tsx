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
    <>
      <div className="form-grid">
        <label>
          Name
          <input value={draft.name} onChange={(event) => onDraftName(event.target.value)} />
        </label>
        <label>
          Type
          <input value={draft.providerType || draft.config.type || ""} readOnly />
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
        <div className="paths-panel">
          <div>Config: {configPaths.configPath ?? "--"}</div>
          <div>Cache: {configPaths.cachePath ?? "--"}</div>
          <div>Temp: {configPaths.tempPath ?? "--"}</div>
        </div>
      ) : null}
    </>
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
        <fieldset className="token-fields">
          <legend>
            Authentication
            <button type="button" onClick={() => onTokenVisible(!tokenVisible)}>
              {tokenVisible ? "Hide" : "Show"}
            </button>
          </legend>
          {fields.map((field) => (
            <label key={field.key}>
              {prettyLabel(field.key)}
              <input
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
    <label>
      {prettyLabel(configKey)}
      <input
        value={value}
        type={isSecretKey(configKey) ? "password" : "text"}
        onChange={(event) => onConfigField(configKey, event.target.value)}
      />
    </label>
  );
}
