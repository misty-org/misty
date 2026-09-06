import type { ComponentProps } from "react";
import { BrowserViewportMenuView } from "./BrowserViewportMenuView";
export * from "./BrowserViewportMenuView";
export function BrowserViewportMenu(props: ComponentProps<typeof BrowserViewportMenuView>) {
  return <BrowserViewportMenuView {...props} />;
}
