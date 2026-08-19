import { DiscordConnectionPanel, SlackConnectionPanel } from "@/features/spaces/integrations";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui";

/** Provider connections belong beside the conversations they create. */
export function ChatIntegrationsSheet(props: {
  spaceId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-[min(520px,96vw)] overflow-y-auto bg-charcoal-bg sm:max-w-[520px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Chat integrations</SheetTitle>
          <SheetDescription>
            Bring external channels into this Space without replacing native Misty conversations.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 grid gap-3">
          <DiscordConnectionPanel
            spaceId={props.spaceId}
            canManage={props.canManage}
            expandedByDefault
          />
          <SlackConnectionPanel
            spaceId={props.spaceId}
            canManage={props.canManage}
            expandedByDefault
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
