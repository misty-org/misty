import { Button, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { useRef, type ReactNode, type Ref } from "react";

const sections = [
  { id: "conversations", label: "Conversations" },
  { id: "activity", label: "Activity" },
  { id: "profile", label: "Profile" },
] as const;
export type AgentSection = (typeof sections)[number]["id"];

export function AgentNavigationIsland(props: {
  id: string;
  activeSection?: AgentSection;
  onSectionChange(section?: AgentSection): void;
  collisionBoundary: HTMLElement | null;
  profileDisabled: boolean;
  contentRef: Ref<HTMLDivElement>;
  dismissalBlocked: boolean;
  restoreTriggerFocus: boolean;
  conversations: ReactNode;
  activity: ReactNode;
  profile: ReactNode;
}) {
  const activeRef = useRef(props.activeSection);
  activeRef.current = props.activeSection;
  return (
    <nav id={props.id} aria-label="Agent navigation" className="agent-navigation-island">
      {sections.map((section) => (
        <Popover
          key={section.id}
          open={props.activeSection === section.id}
          onOpenChange={(open) => {
            if (open) props.onSectionChange(section.id);
            else if (activeRef.current === section.id) props.onSectionChange();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              data-agent-navigation-control
              variant="toolbar"
              size="sm"
              disabled={section.id !== "activity" && props.profileDisabled}
            >
              {section.label}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            ref={props.contentRef}
            className="agent-navigation-dropdown misty-transient-scrollbar"
            aria-label={section.label}
            side="bottom"
            sideOffset={10}
            collisionPadding={12}
            collisionBoundary={props.collisionBoundary}
            onInteractOutside={(event) => {
              // Navigation actions share the page's unsaved-edit guard. Do not dismiss first.
              if (
                props.dismissalBlocked ||
                (event.target instanceof Element &&
                  event.target.closest('[data-agent-navigation-control], [role="alertdialog"]'))
              )
                event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (
                !props.restoreTriggerFocus ||
                (activeRef.current && activeRef.current !== section.id)
              )
                event.preventDefault();
            }}
          >
            {props[section.id]}
          </PopoverContent>
        </Popover>
      ))}
    </nav>
  );
}
