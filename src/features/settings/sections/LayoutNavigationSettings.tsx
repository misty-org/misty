import { savedTabIds } from "../AccountCollectionFilters";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { resolveSetting } from "../profiles/model";
import { useSettingsProfiles } from "../profiles/store";
import { SwitchControl } from "../SettingsControls";

const hiddenSetting = "app.navigation.hidden";
const destinations = [
  { value: "browser", label: "Browser" },
  { value: "agents", label: "Agents" },
  { value: "extensions", label: "Extensions" },
  { value: "spaces", label: "Spaces" },
];

/** Which destinations the navigation rail shows. Hidden ones stay reachable from search. */
export function LayoutNavigationSettings() {
  const ready = useSettingsProfiles((store) => store.ready);
  const edit = useSettingsProfiles((store) => store.edit);
  const raw = useSettingsProfiles((store) =>
    store.state ? String(resolveSetting(store.state, hiddenSetting).value) : "[]",
  );
  const hidden = savedTabIds(raw);
  const visibleCount = destinations.filter((item) => !hidden.includes(item.value)).length;
  const setVisible = (value: string, visible: boolean) => {
    const next = visible ? hidden.filter((id) => id !== value) : [...hidden, value];
    void edit(hiddenSetting, JSON.stringify(next)).catch(() => {});
  };
  return (
    <DesktopSettingsSection
      title="Show in navigation"
      description="Hidden destinations stay available from search and keyboard shortcuts."
    >
      {destinations.map((item) => {
        const visible = !hidden.includes(item.value);
        return (
          <DesktopSettingsRow key={item.value} label={item.label}>
            <SwitchControl
              checked={visible}
              // The rail always keeps at least one destination.
              disabled={!ready || (visible && visibleCount === 1)}
              onChange={(next) => setVisible(item.value, next)}
            />
          </DesktopSettingsRow>
        );
      })}
    </DesktopSettingsSection>
  );
}
