import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  "grid gap-1.5 text-xs font-medium text-muted-foreground capitalize";

const tokenFieldsClass =
  "col-span-full m-0 grid grid-cols-2 gap-x-4 gap-y-3.5 p-3.5 max-[980px]:grid-cols-1";

const tokenLegendClass =
  "flex items-center gap-2.5 px-2 text-foreground";

const pathsPanelClass =
  "mx-[18px] mb-3.5 grid max-w-[760px] gap-1.5 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground [overflow-wrap:anywhere]";

const EMPTY_SELECT_VALUE = "__misty_empty__";

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
          <Input value={draft.name} onChange={(event) => onDraftName(event.target.value)} />
        </label>
        <label className={labelClass}>
          Type
          <Input value={draft.providerType || draft.config.type || ""} readOnly />
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
            <Button
              variant="ghost"
              size="icon"
              type="button"
              title={tokenVisible ? "Hide sensitive values" : "Show sensitive values"}
              aria-label={tokenVisible ? "Hide sensitive values" : "Show sensitive values"}
              aria-pressed={tokenVisible}
              onClick={() => onTokenVisible(!tokenVisible)}
            >
              <AssetIcon src={tokenVisible ? iconAssets.eyeClosed16 : iconAssets.eye16} size={16} />
            </Button>
          </legend>
          {fields.map((field) => (
            <label className={labelClass} key={field.key}>
              {prettyLabel(field.key)}
              <Input
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
        <Select value={value || EMPTY_SELECT_VALUE} onValueChange={(nextValue) => onConfigField(configKey, nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
          {value && !option.choices.some((choice) => choice.value === value) ? (
            <SelectItem value={value}>{value}</SelectItem>
          ) : null}
          {option.choices.map((choice) => (
            <SelectItem key={choice.value || EMPTY_SELECT_VALUE} value={choice.value || EMPTY_SELECT_VALUE}>{choice.help || choice.value || "None"}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      ) : (
        <SecretConfigInput
          value={value}
          sensitive={Boolean(option?.password) || isSecretKey(configKey)}
          visible={tokenVisible}
          onChange={(nextValue) => onConfigField(configKey, nextValue)}
          onVisible={onTokenVisible}
        />
      )}
      {option?.help ? <small className="text-xs normal-case leading-[1.35] text-muted-foreground">{option.help}</small> : null}
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
      <Input
        value={props.value}
        type="text"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_34px] items-center gap-1">
      <Input
        value={props.value}
        type={props.visible ? "text" : "password"}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <Button
        variant="ghost"
        size="icon"
        type="button"
        title={props.visible ? "Hide sensitive value" : "Show sensitive value"}
        aria-label={props.visible ? "Hide sensitive value" : "Show sensitive value"}
        aria-pressed={props.visible}
        onClick={() => props.onVisible(!props.visible)}
      >
        <AssetIcon src={props.visible ? iconAssets.eyeClosed16 : iconAssets.eye16} size={16} />
      </Button>
    </span>
  );
}

function workflowOptionForKey(workflow: ProviderWorkflow | null, key: string): ProviderWorkflowOption | null {
  return workflow?.options.find((option) => option.name === key) ?? null;
}
