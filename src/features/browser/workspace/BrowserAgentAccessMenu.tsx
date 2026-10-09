import { MessageCirclePlus } from "lucide-react";
import { MenuItem } from "@/shared/ui";
import type { BrowserMistyPage } from "./browserRuntime";

/** Attaches the page's text to the next message to Misty; a row of the browser menu. */
export function BrowserAgentAccessMenu(props: {
  nativeRuntime: boolean;
  mistyPage: BrowserMistyPage | null;
  mistyPageLoading: boolean;
  onAttachPage: () => void;
}) {
  return (
    <MenuItem
      icon={<MessageCirclePlus />}
      label={props.mistyPage ? "Refresh page context" : "Include page in chat"}
      disabled={props.mistyPageLoading || !props.nativeRuntime}
      onSelect={props.onAttachPage}
    />
  );
}
