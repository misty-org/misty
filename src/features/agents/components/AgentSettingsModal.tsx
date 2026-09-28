import { IconButton, Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/ui";
import { X } from "lucide-react";
import { useRef } from "react";
import { AgentCompanionPanel } from "../companion/AgentCompanionPanel";

export type AgentSettingsTab = "settings" | "companion";

export function AgentSettingsModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  activeTab: AgentSettingsTab;
  mode?: "edit" | "create";
  children?: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = props.mode === "create" ? "Create new agent" : "Companion";
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <SheetContent
        side="right"
        portal={false}
        overlay={false}
        showCloseButton={false}
        className="agent-settings-panel"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          closeRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
        }}
      >
        <header className="agent-settings-heading">
          <SheetTitle className="text-sm">{title}</SheetTitle>
          <IconButton
            ref={closeRef}
            label="Close settings"
            tooltip={false}
            className="ml-auto"
            onClick={() => props.onOpenChange(false)}
          >
            <X size={16} />
          </IconButton>
        </header>
        <SheetDescription className="sr-only">Configure your agent.</SheetDescription>
        <div className="agent-settings-content misty-transient-scrollbar">
          {props.activeTab === "companion" ? <AgentCompanionPanel /> : props.children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
