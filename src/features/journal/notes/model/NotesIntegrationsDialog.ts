export interface NewNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; body: string }) => void | Promise<void>;
}
