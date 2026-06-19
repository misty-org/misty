import { OpenWithAssociationsPanel } from "./components/OpenWithAssociationsPanel";
import { SettingsJsonPanel } from "./components/SettingsJsonPanel";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { useSettingsStore } from "./useSettingsStore";

export function SettingsWorkspace() {
  const {
    settings,
    settingsText,
    openWithAssociations,
    shortcuts,
    working,
    setSettingsText,
    load,
    saveSettingsDocument,
    removeOpenWithAssociation,
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
      <OpenWithAssociationsPanel
        associations={openWithAssociations}
        working={working}
        onRefresh={() => void load()}
        onRemove={(key) => void removeOpenWithAssociation(key)}
      />
    </section>
  );
}
