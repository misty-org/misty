import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { pluginById, plugins } from "./plugins/registry";
import type { MistyPluginContext } from "./plugins/types";
import {
  configurePluginBridge,
  isHostedPlugin,
  publishHostNotification,
  readSelectedPathsFromHost,
  runHostCommand,
  subscribeHostContext,
} from "./mistyBridge";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const initialPluginId = params.get("plugin") ?? params.get("id");
  const hosted = isHostedPlugin();
  const [selectedPluginId, setSelectedPluginId] = useState(pluginById(initialPluginId).id);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const selectedPlugin = pluginById(selectedPluginId);
  const selectedPanel = selectedPlugin.panels[0];
  const Panel = selectedPanel.component;

  configurePluginBridge(selectedPlugin.id);

  const refreshSelection = useCallback(async () => {
    const paths = await readSelectedPathsFromHost();
    setSelectedPaths(paths);
    return paths;
  }, []);

  useEffect(() => {
    void refreshSelection();
    return subscribeHostContext(setSelectedPaths);
  }, [refreshSelection]);

  const context = useMemo<MistyPluginContext>(() => ({
    pluginId: selectedPlugin.id,
    selectedPaths,
    hosted,
    refreshSelection,
    notify: (level, title, message) => publishHostNotification(selectedPlugin.id, level, title, message),
    runHostCommand,
  }), [hosted, refreshSelection, selectedPaths, selectedPlugin.id]);

  const panel = <article className="plugin-panel" aria-label={selectedPanel.title}><Panel context={context} /></article>;
  if (hosted) return <main className="hosted-shell" style={{ "--plugin-accent": selectedPlugin.accent } as React.CSSProperties}>{panel}</main>;

  return (
    <main className="app-shell">
      <aside className="plugin-sidebar">
        <div className="sidebar-title"><span>Misty</span><strong>Extensions</strong></div>
        <nav className="plugin-list" aria-label="Extensions">
          {plugins.map((plugin) => {
            const Icon = plugin.icon;
            return (
              <button key={plugin.id} type="button" className={plugin.id === selectedPlugin.id ? "plugin-nav-item active" : "plugin-nav-item"} onClick={() => setSelectedPluginId(plugin.id)}>
                <Icon size={18} aria-hidden="true" /><span>{plugin.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <section className="plugin-workspace" style={{ "--plugin-accent": selectedPlugin.accent } as React.CSSProperties}>
        <header className="workspace-header">
          <div><p className="eyebrow">Misty extension</p><h1>{selectedPlugin.name}</h1><p>{selectedPlugin.description}</p></div>
          <button type="button" className="icon-button" onClick={() => void refreshSelection()} aria-label="Refresh selected files"><RefreshCw size={17} aria-hidden="true" /></button>
        </header>
        <div className="selection-strip"><span>Selection</span><strong>{selectedPaths.length ? `${selectedPaths.length} selected · ${selectedPaths[0]}` : "No files selected"}</strong></div>
        {panel}
      </section>
    </main>
  );
}
