import { ConfirmDeleteDialog } from "@misty/ui";

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
