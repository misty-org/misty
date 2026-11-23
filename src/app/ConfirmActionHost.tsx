import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@misty/ui";
import { useConfirmRequest } from "@/shared/lib/confirm_action";

export function ConfirmActionHost() {
  const request = useConfirmRequest((state) => state.request);
  if (!request) return null;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : request.answer(false))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          <AlertDialogDescription>{request.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => request.answer(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => request.answer(true)}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
