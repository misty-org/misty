import {
  FolderTree,
  GitCompareArrows,
  GaugeCircle,
  Globe,
  ListOrdered,
  MonitorPlay,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "@/shared/ui";
import { useContextPanel, type ContextPanelTab } from "./contextPanelStore";
import "./contextPanel.css";

/** The rail's groups: the chat's session first, then the project folder's views, then the app. */
const groups: [ContextPanelTab, string, LucideIcon][][] = [
  [
    ["session", "Session", GaugeCircle],
    ["steps", "Steps", ListOrdered],
  ],
  [
    ["changes", "Changes", GitCompareArrows],
    ["files", "Files", FolderTree],
    ["terminal", "Terminal", SquareTerminal],
  ],
  [
    ["preview", "Preview", MonitorPlay],
    ["browser", "Browser", Globe],
  ],
];

/**
 * The narrow rail down the right edge of a chat, after OpenChamber's: one glyph per panel, and
 * the open panel floats beside the chat as a card. Pressing the open panel's glyph closes it.
 */
export function ContextRail() {
  const open = useContextPanel((state) => state.tab);
  const toggle = useContextPanel((state) => state.toggle);
  return (
    <nav className="context-rail" aria-label="Panels" data-misty-window-drag-block="true">
      {groups.map((group, index) => (
        <div key={group[0][0]} className="context-rail-group" data-first={index === 0 || undefined}>
          {group.map(([id, label, Icon]) => (
            <IconButton
              key={id}
              label={label}
              size="sm"
              className="context-rail-button"
              aria-pressed={open === id}
              onClick={() => toggle(id)}
            >
              <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          ))}
        </div>
      ))}
    </nav>
  );
}
