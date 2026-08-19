import { NotionConnectionPanel } from "@/features/spaces/integrations";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui";

export function JournalIntegrationsSheet(props: {
  spaceId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResourcesChanged: () => void;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-[min(540px,96vw)] overflow-y-auto bg-charcoal-bg sm:max-w-[540px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Journal integrations</SheetTitle>
          <SheetDescription>
            Read selected Notion sources beside native Misty notes and publish only when you choose.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5">
          <NotionConnectionPanel
            spaceId={props.spaceId}
            canManage={props.canManage}
            expandedByDefault
            onResourcesChanged={props.onResourcesChanged}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
