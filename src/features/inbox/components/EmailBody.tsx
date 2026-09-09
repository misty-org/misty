import type { ComponentProps } from "react";
import { hostInboxUiRuntime } from "../hostInboxUiRuntime";
import { EmailBodyView, EmailHtmlFrameView, EmailMarkdownView } from "./EmailBodyView";
export * from "./EmailBodyView";
export function EmailBody(props: Omit<ComponentProps<typeof EmailBodyView>, "runtime">) {
  return <EmailBodyView {...props} runtime={hostInboxUiRuntime} />;
}
export function EmailHtmlFrame(props: Omit<ComponentProps<typeof EmailHtmlFrameView>, "runtime">) {
  return <EmailHtmlFrameView {...props} runtime={hostInboxUiRuntime} />;
}
export function EmailMarkdown(props: Omit<ComponentProps<typeof EmailMarkdownView>, "runtime">) {
  return <EmailMarkdownView {...props} runtime={hostInboxUiRuntime} />;
}
