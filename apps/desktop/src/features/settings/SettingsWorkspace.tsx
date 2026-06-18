import { SettingsJsonPanel } from "./components/SettingsJsonPanel";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { useSettingsStore } from "./useSettingsStore";

export function SettingsWorkspace() {
  const {
    settings,
    settingsText,
    shortcuts,
    working,
    setSettingsText,
    load,
    saveSettingsDocument,
    setShortcut,
    saveShortcuts,
  } = useSettingsStore();

  return (
    <section className="settings-grid">
      <SettingsJsonPanel
        settings={settings}
        settingsText={settingsText}
        working={working}
        onSettingsText={setSettingsText}
        onRefresh={() => void load()}
        onSave={() => void saveSettingsDocument()}
      />
      <ShortcutsPanel
        shortcuts={shortcuts}
        working={working}
        onShortcutChange={setShortcut}
        onSave={() => void saveShortcuts()}
      />
    </section>
  );
}
