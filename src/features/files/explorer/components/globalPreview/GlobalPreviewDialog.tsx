import type { ComponentProps } from "react";
import { GlobalPreviewDialogView } from "./GlobalPreviewDialogView";
import { hostPreviewRuntime } from "./hostPreviewRuntime";
export function GlobalPreviewDialog(
  props: Omit<ComponentProps<typeof GlobalPreviewDialogView>, "runtime">,
) {
  return <GlobalPreviewDialogView {...props} runtime={hostPreviewRuntime} />;
}
