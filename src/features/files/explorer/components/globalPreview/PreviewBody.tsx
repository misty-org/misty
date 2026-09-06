import type { ComponentProps } from "react";
import { PreviewBodyView } from "./PreviewBodyView";
import { hostPreviewRuntime } from "./hostPreviewRuntime";
export function PreviewBody(props: Omit<ComponentProps<typeof PreviewBodyView>, "runtime">) {
  return <PreviewBodyView {...props} runtime={hostPreviewRuntime} />;
}
