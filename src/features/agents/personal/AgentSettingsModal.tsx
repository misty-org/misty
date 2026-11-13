import { TourCorner } from "../TourCorner";
import { IconButton, Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/ui";
import { X } from "lucide-react";
import { useRef } from "react";
import { AgentCompanionPanel } from "../tutor/cursor/AgentCompanionPanel";

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
  const title =
    props.mode === "create"
      ? "Create new agent"
      : props.activeTab === "companion"
        ? "Companion"
        : "Agent settings";
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <SheetContent
        side="right"
        portal={false}
        overlay={false}
        showCloseButton={false}
        docked
        className="flex w-105 flex-col"
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
        <header className="flex h-14 shrink-0 items-center gap-1.5 pr-3 pl-4">
          <SheetTitle className="text-sm">{title}</SheetTitle>
          <IconButton
            ref={closeRef}
            label="Close settings"
            className="ml-auto"
            onClick={() => props.onOpenChange(false)}
          >
            <X />
          </IconButton>
        </header>
        <SheetDescription className="sr-only">Configure your agent.</SheetDescription>
        <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-auto px-5 pt-3 pb-16">
          {props.activeTab === "companion" ? <AgentCompanionPanel /> : props.children}
        </div>
        {/* The companion tab has none of the fields the tour points at. */}
        {props.activeTab === "companion" ? null : <TourCorner tour="agent-settings" />}
      </SheetContent>
    </Sheet>
  );
}
