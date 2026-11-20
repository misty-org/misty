import { ConfirmDeleteDialog } from "@misty/ui";

/** Asks before a mod removes an app from the Space. The Space's files stay in Media. */
export function RemoveAppDialog({
  appName,
  open,
  onOpenChange,
  onRemove,
}: {
  appName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => Promise<void>;
}) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${appName}?`}
      what={`${appName} goes from the Space for everyone, with the settings it kept. What it saved stays in Files.`}
      confirmLabel="Remove"
      onConfirm={onRemove}
    />
  );
}
