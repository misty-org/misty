import {
  FolderTree,
  GitCompareArrows,
  GaugeCircle,
  Globe,
  ListOrdered,
  MonitorPlay,
  SquarePen,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { CustomizableBar, IconButton, type BarItem } from "@/shared/ui";
import { isBrowserOpen, useAgentBrowser } from "../agent-browser/agentBrowserStore";
import { SessionGoalButton } from "../goals/SessionGoalButton";
import { toggleChatBrowser } from "../tabs/agentPersonTabs";
import { chatKey } from "../conversations/state/draftChat";
import { useContextPanel, type ContextPanelTab } from "./contextPanelStore";
import { useRailLayout, type RailItemId } from "./railLayoutStore";

/** The panels the rail opens: the chat's session, then the project folder's views. */
const panels: [ContextPanelTab, string, LucideIcon][] = [
  ["session", "Session", GaugeCircle],
  ["steps", "Steps", ListOrdered],
  ["changes", "Changes", GitCompareArrows],
  ["files", "Files", FolderTree],
  ["terminal", "Terminal", SquareTerminal],
  ["preview", "Preview", MonitorPlay],
];

/**
 * The one column of controls down the chat's right edge: a new task, the chat's goal, the session
 * card and steps, the project folder's views, then the browser and the local preview, evenly
 * spaced with nothing parting them. The person drags them into their own order and hides what they
 * don't use from a right-click on the rail (`railLayoutStore`). Every button is the size of the
 * tab row's layout button and sits on the same line under it. One view at a time floats beside
 * the chat in the side panel (the session card can stay open beside it); pressing its glyph again
 * closes it.
 */
export function ContextRail(props: {
  conversationId: string;
  disabled: boolean;
  onNewTask(): void;
}) {
  const open = useContextPanel((state) => state.tab);
  const session = useContextPanel((state) => state.session);
  const toggle = useContextPanel((state) => state.toggle);
  // A chat that hasn't started keeps its goal and browser under the draft key until it does.
  const chat = chatKey(props.conversationId);
  const browserOpen = useAgentBrowser((state) => isBrowserOpen(state.chats[chat]));
  const layout = useRailLayout(
    useShallow((state) => ({ order: state.order, hidden: state.hidden })),
  );
  useEffect(() => void useRailLayout.getState().load(), []);
  // The panel shows one view; the browser holds it only while no other view is open.
  const pressed = (id: ContextPanelTab) => (id === "session" ? session : open === id);
  const items: Record<RailItemId, BarItem> = {
    "new-task": {
      label: "New task",
      node: (
        <IconButton
          label="New task"
          tooltipSide="left"
          disabled={props.disabled}
          onClick={props.onNewTask}
        >
          <SquarePen />
        </IconButton>
      ),
    },
    // Every tool works whether or not the chat has started: a goal or a browser set on an empty
    // chat becomes the chat's own with its first message (`draftChat.ts`).
    goal: { label: "Goal", node: <SessionGoalButton conversationId={chat} /> },
    ...(Object.fromEntries(
      panels.map(([id, label, Icon]) => [
        id,
        {
          label,
          node: (
            <IconButton
              label={label}
              tooltipSide="left"
              aria-pressed={pressed(id)}
              onClick={() => toggle(id)}
            >
              <Icon />
            </IconButton>
          ),
        },
      ]),
    ) as Record<(typeof panels)[number][0], BarItem>),
    browser: {
      label: "Browser",
      node: (
        <IconButton
          label="Browser"
          tooltipSide="left"
          aria-pressed={browserOpen && !open}
          onClick={() =>
            // With another view in the panel, the browser takes it back instead of closing.
            browserOpen && open ? useContextPanel.getState().close() : toggleChatBrowser(chat)
          }
        >
          <Globe />
        </IconButton>
      ),
    },
  };
  return (
    <nav
      // Its 32px buttons are the tab row's layout button's size, 12px from the page's edge like
      // it, the first centred on the 48px header band the tab row centres its buttons in.
      className="flex flex-none flex-col pt-[calc((var(--ui-header)-32px)/2)] pr-3 pb-2 pl-1"
      aria-label="Panels"
      data-misty-window-drag-block="true"
      data-tour="chat-panels"
    >
      {/* It fills the rail, so a right-click below the last button still opens its menu. */}
      <CustomizableBar
        label="Panels"
        axis="y"
        items={items}
        layout={layout}
        onChange={(next) => useRailLayout.getState().set(next)}
        onReset={() => useRailLayout.getState().reset()}
        className="flex-1 gap-1"
      />
    </nav>
  );
}
