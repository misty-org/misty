import { reportSystemError } from "@/features/activity";
import type { ComponentProps } from "react";
import { DrawingHeaderView } from "./DrawingHeaderView";
export function DrawingHeader(
  props: Omit<ComponentProps<typeof DrawingHeaderView>, "reportError">,
) {
  return <DrawingHeaderView {...props} reportError={reportSystemError} />;
}
