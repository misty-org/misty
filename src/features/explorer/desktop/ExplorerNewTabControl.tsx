import { FolderOpen, House } from "lucide-react";
import { NewTabMenu } from "@/features/workspace";
import type { MultiPanelTab } from "@/models/interfaces/workspace";

export function createExplorerAddTabControl(homePath: string) {
  return (tab: MultiPanelTab, addTab: (path: string, title?: string) => string) => (
    <NewTabMenu
      ariaLabel="New Files tab"
      options={[
        {
          id: "current-path",
          label: "Current path",
          icon: FolderOpen,
          onSelect: () => addTab(tab.path, tab.title),
        },
        {
          id: "home",
          label: "Home",
          icon: House,
          onSelect: () => addTab(homePath, "Home"),
        },
      ]}
    />
  );
}
