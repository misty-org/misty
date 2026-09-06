import type { MultiPanelTab } from "@/features/workspace";
import { NewTabMenu } from "@/features/workspace/NewTabMenu";
import { FolderOpen, House } from "lucide-react";

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
