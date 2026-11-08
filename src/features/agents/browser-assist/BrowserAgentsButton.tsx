import { Bot } from "lucide-react";
import { showAgentsPanel, useMistyPanelStore } from "../panel/mistyPanelStore";
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
