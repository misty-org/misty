import { reportSystemError } from "@/features/activity";
import type { ComponentProps } from "react";
import { DrawingPreviewHeaderView } from "./DrawingPreviewHeaderView";
export function DrawingPreviewHeader(
  props: Omit<ComponentProps<typeof DrawingPreviewHeaderView>, "reportError">,
) {
  return <DrawingPreviewHeaderView {...props} reportError={reportSystemError} />;
}
