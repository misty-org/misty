export const pluginCatalogChangedEvent = "misty:plugins-changed";

export function publishPluginCatalogChanged() {
  window.dispatchEvent(new CustomEvent(pluginCatalogChangedEvent));
}
