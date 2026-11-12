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
  Field,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Text,
  Tooltip,
} from "@/shared/ui";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

type Open = "dialog" | "alert" | "sheet" | null;

export function OverlaysSection() {
  const [open, setOpen] = useState<Open>(null);
  const openChange = (kind: Exclude<Open, null>) => (next: boolean) => setOpen(next ? kind : null);
  return (
    <GallerySection title="Overlays">
      <GalleryRow label="Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Connection details</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="grid gap-2">
            <Text size="control" weight="medium" tone="bright">
              Connected to Misty Cloud
            </Text>
            <Text size="meta" tone="muted" lines={2}>
              Rich content lives here: details, small forms and pickers.
            </Text>
          </PopoverContent>
        </Popover>
      </GalleryRow>
      <GalleryRow label="Tooltip">
        <Tooltip content="Branch">
          <Button variant="quiet">Label only</Button>
        </Tooltip>
        <Tooltip content="Search" shortcut="⌘K">
          <Button variant="quiet">With shortcut</Button>
        </Tooltip>
        <Tooltip content="Opens below" side="bottom">
          <Button variant="quiet">Below</Button>
        </Tooltip>
        <Tooltip content="A longer tooltip wraps inside its own width instead of running off the edge of the window.">
          <Button variant="quiet">Long text</Button>
        </Tooltip>
      </GalleryRow>
      <GalleryRow label="Dialogs">
        <Button onClick={() => setOpen("dialog")}>Open dialog</Button>
        <Dialog open={open === "dialog"} onOpenChange={openChange("dialog")}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Space</DialogTitle>
              <DialogDescription>Everyone in the Space sees the new name.</DialogDescription>
            </DialogHeader>
            <Field label="Name">
              <Input defaultValue="Design team" />
            </Field>
            <DialogFooter>
              <Button variant="quiet" size="lg" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="lg" onClick={() => setOpen(null)}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button onClick={() => setOpen("alert")}>Confirm, not a delete</Button>
        <AlertDialog open={open === "alert"} onOpenChange={openChange("alert")}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave without sending?</AlertDialogTitle>
              <AlertDialogDescription>Your draft stays in the composer.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction>Leave</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button onClick={() => setOpen("sheet")}>Open sheet</Button>
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
