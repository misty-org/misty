import type { ReactNode } from "react";

/** The content row under the toolbar: the page. */
export function BrowserMistyRow({ children }: { tabId: string; children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0">{children}</div>;
}
