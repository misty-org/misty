import type { ComponentProps } from "react";
import { hostInboxUiRuntime } from "../hostInboxUiRuntime";
import { ComposeDialogView } from "./ComposeDialogView";
export function ComposeDialog(props: Omit<ComponentProps<typeof ComposeDialogView>, "runtime">) {
  return <ComposeDialogView {...props} runtime={hostInboxUiRuntime} />;
}
