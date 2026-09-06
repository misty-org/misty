import type { ComponentProps } from "react";
import { hostInboxUiRuntime } from "../hostInboxUiRuntime";
import { InlineQuickReplyView } from "./InlineQuickReplyView";
export function InlineQuickReply(
  props: Omit<ComponentProps<typeof InlineQuickReplyView>, "runtime">,
) {
  return <InlineQuickReplyView {...props} runtime={hostInboxUiRuntime} />;
}
