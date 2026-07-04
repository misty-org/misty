import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { pluginById, plugins } from "./plugins/registry";
import type { MistyPluginContext } from "./plugins/types";
import {
  publishHostNotification,
  readSelectedPathsFromHost,
  runHostCommand,
} from "./mistyBridge";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const initialPluginId = params.get("plugin") ?? params.get("id");
  const [selectedPluginId, setSelectedPluginId] = useState(pluginById(initialPluginId).id);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const selectedPlugin = pluginById(selectedPluginId);
  const selectedPanel = selectedPlugin.panels[0];
  const Panel = selectedPanel.component;

  const refreshSelection = () => {
    void readSelectedPathsFromHost().then(setSelectedPaths);
  };

  useEffect(refreshSelection, []);

  const context = useMemo<MistyPluginContext>(() => ({
    pluginId: selectedPlugin.id,
    selectedPaths,
    notify: (level, title, message) => {
      publishHostNotification(selectedPlugin.id, level, title, message);
    },
    runHostCommand,
  }), [selectedPaths, selectedPlugin.id]);

  return (
    <main className="app-shell">
      <aside className="plugin-sidebar">
        <div className="sidebar-title">
          <span>Misty</span>
          <strong>Plugins</strong>
        </div>
        <nav className="plugin-list" aria-label="Plugins">
          {plugins.map((plugin) => {
            const Icon = plugin.icon;
            const active = plugin.id === selectedPlugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                className={active ? "plugin-nav-item active" : "plugin-nav-item"}
                onClick={() => setSelectedPluginId(plugin.id)}
                title={plugin.name}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{plugin.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="plugin-workspace" style={{ "--plugin-accent": selectedPlugin.accent } as React.CSSProperties}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Web plugin</p>
            <h1>{selectedPlugin.name}</h1>
            <p>{selectedPlugin.description}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={refreshSelection}
            title="Refresh selected paths"
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="selection-strip">
          <span>Selected file</span>
          <strong>{selectedPaths[0] ? selectedPaths[0] : "No file provided by host"}</strong>
        </div>

        <article className="plugin-panel" aria-label={selectedPanel.title}>
          <Panel context={context} />
        </article>
      </section>
    </main>
  );
}
