import { DesktopSettingsRow as Row } from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { ChoiceControl, SwitchControl, TextControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

/** One synced preference from the settings registry, with its matching control. */
export function PreferenceRow({ id, description }: { id: string; description?: string }) {
  const d = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = fromLegacy(d, section?.[d.key]);
  const update = (next: string | number | boolean) =>
    store.updateSetting(
      d.section,
      d.key,
      d.legacyValues ? d.legacyValues.indexOf(String(next)) : next,
    );
  return (
    <Row label={d.label} description={description}>
      {d.type === "boolean" ? (
        <SwitchControl
          checked={Boolean(value)}
          disabled={store.working || !ready}
          onChange={update}
        />
      ) : d.enum ? (
        <ChoiceControl
          disabled={store.working || !ready}
          value={String(value)}
          onValueChange={update}
          options={d.enum.map((v) => ({ value: v, label: v || "Model default" }))}
        />
      ) : (
        <TextControl value={String(value)} disabled={store.working || !ready} onCommit={update} />
      )}
    </Row>
  );
}
