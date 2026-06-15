import { reportSystemError } from "@/features/activity";
import type { ComponentProps } from "react";
import { NewDrawingDialogView } from "./NewDrawingDialogView";
export function NewDrawingDialog(
  props: Omit<ComponentProps<typeof NewDrawingDialogView>, "reportError">,
) {
  return <NewDrawingDialogView {...props} reportError={reportSystemError} />;
}
