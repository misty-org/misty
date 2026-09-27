import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function OverlaysSection() {
  return (
    <GallerySection
      title="Overlays"
      note="Popover is for rich content (details, pickers, forms). Anything that lists actions is a DropdownMenu."
    >
      <GalleryRow label="Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Site information
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="grid gap-2">
            <p className="m-0 text-sm font-medium text-cream-bright">Connection is secure</p>
            <p className="m-0 text-xs text-cream-muted">
              Rich content lives here: details, small forms, pickers.
            </p>
          </PopoverContent>
        </Popover>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm">
                Hover for tooltip
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips are one line</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </GalleryRow>
      <GalleryRow label="Dialogs">
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename space</DialogTitle>
              <DialogDescription>Everyone in the space sees the new name.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Delete…
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this note?</AlertDialogTitle>
              <AlertDialogDescription>
                It moves to Recently Deleted for 30 days.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary" size="sm">
              Open sheet
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Details</SheetTitle>
              <SheetDescription>Sheets hold secondary panels.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </GalleryRow>
    </GallerySection>
  );
}
