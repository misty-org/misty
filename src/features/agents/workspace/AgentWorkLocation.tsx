import { useState, type ReactNode } from "react";
import { Check, MessageSquare, Monitor, PanelsTopLeft } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { showAgentWindow } from "../agentWindowHandoff";
import { visibleAutopilotAvailable } from "../betaModes";

const locations = [
  {
    mode: "user",
    label: "In this conversation",
    description: "Use connected tools and attached context without controlling your screen.",
    icon: MessageSquare,
  },
  {
    mode: "team",
    label: "Separate Misty window",
    description:
      "Use an agent browser window with this device’s browser session. Your current window stays yours.",
    icon: PanelsTopLeft,
  },
  {
    mode: "agent",
    label: "Control this screen",
    description: "Allow work on your current screen. Pause or stop to take over.",
    icon: Monitor,
  },
] as const;

/** The control bar above the composer: where work happens, plus any extra work controls. */
export function AgentWorkLocation({ children }: { children?: ReactNode }) {
  const [windowNotice, setWindowNotice] = useState("");
  const mode = useMistyStore((s) => s.executionMode ?? "user");
  const working = useMistyStore((s) => s.working);
  const selected = locations.find((item) => item.mode === mode) ?? locations[0];
  const Icon = selected.icon;
  return (
    <div className="agent-control-bar" role="group" aria-label="Conversation controls">
      <DropdownMenu>
        <MenuTrigger
          label={selected.label}
          icon={<Icon size={13} />}
          disabled={working}
          title={selected.description}
        />
        <DropdownMenuContent align="start">
          {locations.map((item) => (
            <DropdownMenuItem
              key={item.mode}
              disabled={
                item.mode === "team"
                  ? !(hasTauriInternals() && /Mac|Win/.test(navigator.platform))
                  : item.mode === "agent" && !visibleAutopilotAvailable()
              }
              onSelect={() => useMistyStore.setState({ executionMode: item.mode })}
            >
              <item.icon size={15} />
              {item.label}
              {mode === item.mode && <Check size={14} className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === "team" && hasTauriInternals() && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setWindowNotice("");
            const state = useMistyStore.getState();
            if (!state.selectedAgentId) return;
            void showAgentWindow(state.accountId, state.selectedAgentId).catch((error: unknown) =>
              setWindowNotice(
                error instanceof Error && !error.message.includes("No agent window is open")
                  ? error.message
                  : "The window will be available once the task starts.",
              ),
            );
          }}
        >
          <PanelsTopLeft size={13} />
          Show agent window
        </Button>
      )}
      {children}
      {windowNotice && (
        <p role="status" className="text-xs text-cream-muted">
          {windowNotice}
        </p>
      )}
    </div>
  );
}
