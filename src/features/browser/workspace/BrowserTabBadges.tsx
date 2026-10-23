import { cn } from "@/shared/ui";
import { VenetianMask } from "lucide-react";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";

/** Marks beside the address: a private window's tab, and a tab scoped to Misty's work. */
export function BrowserTabBadges(props: { agentOwned: boolean }) {
  return (
    <>
      {isIncognitoWindow() ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border border-cream/[0.08]",
            "bg-cream/[0.045] px-2 py-1 text-[10px] font-medium text-cream-muted",
          )}
          title="Private tab: no history, and cookies and site data are discarded when the last private tab closes"
        >
          <VenetianMask className="size-3" aria-hidden="true" />
          Private
        </span>
      ) : null}
      {props.agentOwned ? (
        <span
          className="shrink-0 rounded-md border border-cream/[0.08] bg-cream/[0.045] px-2 py-1 text-[10px] font-medium text-cream-muted"
          title="This browser tab is scoped to Misty's current work"
        >
          Misty
        </span>
      ) : null}
    </>
  );
}
