import {
  FolderTree,
  GitCompareArrows,
  GaugeCircle,
  Globe,
  BookOpenText,
  ListOrdered,
  SquarePen,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { CustomizableBar, IconButton, type BarItem } from "@misty/ui";
import {
  closeAgentBrowser,
  isBrowserOpen,
  useAgentBrowser,
} from "../agent-browser/agent_browser_store";
import { SessionGoalButton } from "../goals/SessionGoalButton";
import { useSidePanelShown } from "./ChatSidePanels";
import { toggleChatBrowser } from "../tabs/agent_person_tabs";
import { chatKey } from "../conversations/state/draft_chat";
import { useContextPanel, type ContextPanelTab } from "./context_panel_store";
import { useRailLayout, type RailItemId } from "./rail_layout_store";
import { useSearchParams } from "react-router-dom";

const panels: [ContextPanelTab, string, LucideIcon][] = [
  ["session", "Session", GaugeCircle],
  ["steps", "Steps", ListOrdered],
  ["changes", "Changes", GitCompareArrows],
  ["files", "Files", FolderTree],
  ["terminal", "Terminal", SquareTerminal],
];

export function ContextRail(props: {
  conversationId: string;
  disabled: boolean;
  onNewTask(): void;
}) {
  const [, setParams] = useSearchParams();
  const open = useContextPanel((state) => state.tab);
  const session = useContextPanel((state) => state.session);
  const toggle = useContextPanel((state) => state.toggle);
  const chat = chatKey(props.conversationId);
  const browserOpen = useAgentBrowser((state) => isBrowserOpen(state.chats[chat]));
  const layout = useRailLayout(
    useShallow((state) => ({ order: state.order, hidden: state.hidden })),
  );
  useEffect(() => void useRailLayout.getState().load(), []);
  const sidePanel = useSidePanelShown(chat);
  const pressed = (id: ContextPanelTab) => (id === "session" ? session && !sidePanel : open === id);
  const press = (id: ContextPanelTab) => {
    if (id !== "session" || !sidePanel) return toggle(id);
    if (open) useContextPanel.getState().close();
    else closeAgentBrowser(chat);
    useContextPanel.getState().show("session");
  };
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
    goal: { label: "Goal", node: <SessionGoalButton conversationId={chat} /> },
    memory: {
      label: "Memory",
      node: (
        <IconButton
          label="Memory"
          tooltipSide="left"
          onClick={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("view", "memory");
              return next;
            })
          }
        >
          <BookOpenText />
        </IconButton>
      ),
    },
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
              onClick={() => press(id)}
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
      className="flex flex-none flex-col px-3 pt-[calc((var(--ui-header)-var(--spacing)*8)/2)] pb-2"
      aria-label="Panels"
      data-misty-window-drag-block="true"
      data-tour="chat-panels"
    >
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
