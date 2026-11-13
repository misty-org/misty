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
  PickerList,
  PickerSearch,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverText,
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
      <GalleryRow label="Popover panel">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Welcome tour</Button>
          </PopoverTrigger>
          <PopoverContent align="start" size="sm">
            <PopoverHeader title="Welcome tour" />
            <PopoverText>A short walk through what's here.</PopoverText>
            <PopoverActions>
              <Button variant="secondary">Replay tour</Button>
            </PopoverActions>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Rename</Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <PopoverHeader title="Rename Design" />
            <PopoverText>Everyone in the Space sees the new name.</PopoverText>
            <PopoverBody>
              <Input aria-label="Space name" defaultValue="Design" />
            </PopoverBody>
            <PopoverActions>
              <Button variant="quiet">Cancel</Button>
              <Button variant="secondary">Rename</Button>
            </PopoverActions>
          </PopoverContent>
        </Popover>
      </GalleryRow>
      <GalleryRow label="Popover picker">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Branch</Button>
          </PopoverTrigger>
          <PopoverContent align="start" kind="flush">
            <PickerSearch aria-label="Search branches" placeholder="Search branches" />
            <PickerList aria-label="Branches">
              <Text size="control" tone="default" className="px-2 py-1.5">
                main
              </Text>
              <Text size="control" tone="default" className="px-2 py-1.5">
                design-protocol
              </Text>
            </PickerList>
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
