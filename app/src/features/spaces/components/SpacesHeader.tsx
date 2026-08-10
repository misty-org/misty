import { ChromeTabStrip, NewTabMenu } from "@/features/workspace";
import { LibraryBig, ListChecks, MessageCircle, Notebook } from "lucide-react";
import type { SpacesTab, SpacesTabsSession } from "../store/useSpacesTabsStore";

export type SpaceTabDestination = "journal" | "planner" | "chat" | "library";

const spaceTabOptions = [
  { id: "journal", label: "Journal", icon: Notebook },
  { id: "planner", label: "Planner", icon: ListChecks },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "library", label: "Library", icon: LibraryBig },
] satisfies ReadonlyArray<{
  id: SpaceTabDestination;
  label: string;
  icon: typeof Notebook;
}>;

export function SpacesHeader(props: {
  session: SpacesTabsSession | undefined;
  onAddTab: (destination: SpaceTabDestination) => void;
  onCloseTab: (tabId: string) => void;
  onReorderTab: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}) {
  const tabs = props.session?.tabs ?? [];
  return (
    <header className="h-[46px] min-w-0 border-b border-charcoal-border/45 bg-charcoal-bg">
      <ChromeTabStrip
        tabs={tabs.map(tabDescriptor)}
        activeTabId={props.session?.activeTabId ?? ""}
        ariaLabel="Open Space tabs"
        addTabControl={<NewSpaceTabButton onAddTab={props.onAddTab} />}
        canCloseTab={() => true}
        onAddTab={() => undefined}
        onCloseTab={(tab) => props.onCloseTab(tab.id)}
        onReorderTab={props.onReorderTab}
        onSelectTab={props.onSelectTab}
      />
    </header>
  );
}

function NewSpaceTabButton(props: { onAddTab: (destination: SpaceTabDestination) => void }) {
  return (
    <NewTabMenu
      ariaLabel="New Space tab"
      options={spaceTabOptions.map((option) => ({
        ...option,
        onSelect: () => props.onAddTab(option.id),
      }))}
    />
  );
}

function tabDescriptor(tab: SpacesTab) {
  return {
    id: tab.id,
    title: tab.kind === "space" ? spaceTabTitle(tab.route) : tab.title,
    path: tab.kind === "space" ? tab.route : `misty-workspace://${tab.kind}/${tab.id}`,
    paneId: tab.id,
  };
}

function spaceTabTitle(route: string): string {
  const section = route.split(/[/?#]/).filter(Boolean)[2] ?? "space";
  if (section === "notes" || section === "drawings") return "Journal";
  if (section === "planner") return "Planner";
  if (section === "chat") return "Chat";
  if (section === "library") return "Library";
  if (section === "settings") return "Settings";
  return "Space";
}
