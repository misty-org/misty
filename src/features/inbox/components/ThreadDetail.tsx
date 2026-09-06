import type { ComponentProps } from "react";
import { hostInboxUiRuntime } from "../hostInboxUiRuntime";
import { ThreadDetailView } from "./ThreadDetailView";
export function ThreadDetail(props: Omit<ComponentProps<typeof ThreadDetailView>, "runtime">) {
  return <ThreadDetailView {...props} runtime={hostInboxUiRuntime} />;
}
