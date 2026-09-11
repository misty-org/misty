import type { ComponentProps } from "react";
import { PreviewBodyView } from "./PreviewBodyView";
import { useHostPreviewRuntime } from "./hostPreviewRuntime";
export function PreviewBody(props: Omit<ComponentProps<typeof PreviewBodyView>, "runtime">) {
  return <PreviewBodyView {...props} runtime={useHostPreviewRuntime()} />;
}
