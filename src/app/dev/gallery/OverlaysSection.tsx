import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function OverlaysSection() {
  const [open, setOpen] = useState<"dialog" | "alert" | "sheet" | null>(null);
  const openChange = (kind: "dialog" | "alert" | "sheet") => (next: boolean) =>
    setOpen(next ? kind : null);
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
        <Button size="sm" onClick={() => setOpen("dialog")}>
          Open dialog
        </Button>
        <Dialog open={open === "dialog"} onOpenChange={openChange("dialog")}>
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
        <Button variant="destructive" size="sm" onClick={() => setOpen("alert")}>
          Delete…
        </Button>
        <AlertDialog open={open === "alert"} onOpenChange={openChange("alert")}>
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
        <Button variant="secondary" size="sm" onClick={() => setOpen("sheet")}>
          Open sheet
        </Button>
        <Sheet open={open === "sheet"} onOpenChange={openChange("sheet")}>
          <SheetContent>
            <SheetTitle>Details</SheetTitle>
            <SheetDescription>Sheets hold secondary panels.</SheetDescription>
          </SheetContent>
        </Sheet>
      </GalleryRow>
    </GallerySection>
  );
}
