import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { showAgentsPanel, useMistyPanelStore } from "@/features/agents";
import { appIcon, IconButton } from "@/shared/ui";

const AgentsIcon = appIcon("agents") ?? Bot;

/** The toolbar's Agents button, an agent conversation in the side panel. */
export function BrowserAgentsButton() {
  const shown = useMistyPanelStore((s) => s.open);
  return (
    <IconButton label="Agents" aria-pressed={shown} onClick={showAgentsPanel}>
      {/* Fills its box like the round glyphs, so the toolbar draws it a size down. */}
      <AgentsIcon aria-hidden className="size-4" />
    </IconButton>
  );
}

/** The content row under the toolbar: the page. */
export function BrowserMistyRow({ children }: { tabId: string; children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0">{children}</div>;
}
