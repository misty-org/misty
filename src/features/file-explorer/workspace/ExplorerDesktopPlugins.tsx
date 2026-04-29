/**
 * Explorer's plugin surfaces.
 *
 * Implementations live in `explorerPlugins/`; this file stays as the import
 * path the desktop shell already uses.
 */
export { ExplorerExtensionsPanel } from "./explorerPlugins/ExplorerExtensionsPanel";
export {
  ExplorerPluginTabContent,
  ExplorerPluginTabHeader,
} from "./explorerPlugins/ExplorerPluginTabContent";
export { ExplorerTray } from "./explorerPlugins/ExplorerTray";
export { pluginMenuItems, stringArraysEqual } from "./explorerPlugins/pluginMenu";
export {
  canCloseExplorerTab,
  canOpenTerminalPath,
  ensureFilesBrowseTab,
  isChromeTabPath,
  isRemotesTabPath,
  isTransfersTabPath,
  openTransfersTab,
  parsePluginTabPath,
  toggleActiveTabPanelVisibility,
} from "./explorerPlugins/tabPaths";
