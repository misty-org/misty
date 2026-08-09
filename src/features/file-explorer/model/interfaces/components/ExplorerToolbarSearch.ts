import type { PluginCommandEntry } from "@/services/misty/model/misty-api";
import { type ExplorerCommandQueryMode } from "../../../store";
import type { ExplorerSearchNavigationTarget } from "../utils/searchNavigation";
import type { ExplorerLocationResult } from "./ExplorerToolbarModel";

export interface ExplorerToolbarSearchProps {
  paneId: string;
  path: string;
  commandQuery: string;
  commandQueryMode: ExplorerCommandQueryMode;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
  onCommandQuery: (value: string) => void;
  onNavigateLocation: (path: string) => void;
  onNavigateSearchResult: (target: ExplorerSearchNavigationTarget) => void;
  onRunCommand: (commandId: string) => void;
}
