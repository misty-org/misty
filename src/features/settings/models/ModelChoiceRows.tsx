import { cn, Input } from "@/shared/ui";
import { DesktopSettingsRow as Row } from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../devicePreferences/registry";
import { useDevicePreferences } from "../devicePreferences/store";
import { settingsDisabledControlClass } from "../settingsConstants";
import { DropdownControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

/** A `models` device setting: its saved value, whether it can be edited now, and its writer. */
export function useModelSetting(id: string) {
  const definition = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useDevicePreferences((s) => s.ready);
  const section = store.settings?.document[definition.section] as
    Record<string, unknown> | undefined;
  return {
    value: String(fromLegacy(definition, section?.[definition.key])),
    disabled: store.working || !ready,
    set: (next: string) => store.updateSetting(definition.section, definition.key, next),
  };
}

/** A checkmarked dropdown for a `models` setting with labelled choices. */
export function ModelDropdownRow(props: {
  id: string;
  label: string;
  description: string;
  options: { value: string; label: string }[];
}) {
  const setting = useModelSetting(props.id);
  return (
    <Row label={props.label} description={props.description}>
      <DropdownControl
        value={setting.value}
        options={props.options}
        disabled={setting.disabled}
        className="w-[240px]"
        onValueChange={setting.set}
      />
    </Row>
  );
}

/**
 * Free text for a model or an address, with suggestions. `normalize` turns what was typed
 * into the stored form (for models, `<provider>/<model>`); an empty value clears it.
 */
export function ModelTextRow(props: {
  id: string;
  label: string;
  description: string;
  placeholder?: string;
  suggestions?: string[];
  normalize?: (value: string) => string;
}) {
  const setting = useModelSetting(props.id);
  const listId = `models-${props.id.replace(/\W/g, "-")}`;
  const commit = (raw: string) => {
    const next = props.normalize ? props.normalize(raw) : raw.trim();
    if (next !== setting.value) setting.set(next);
  };
  return (
    <Row label={props.label} description={props.description}>
      <Input
        aria-label={props.label}
        key={setting.value}
        defaultValue={setting.value}
        placeholder={props.placeholder}
        list={props.suggestions?.length ? listId : undefined}
        spellCheck={false}
        autoComplete="off"
        disabled={setting.disabled}
        className={cn("w-[240px] max-w-full", settingsDisabledControlClass)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") {
            event.currentTarget.value = setting.value;
            event.currentTarget.blur();
          }
        }}
      />
      {props.suggestions?.length ? (
        <datalist id={listId}>
          {props.suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </Row>
  );
}
