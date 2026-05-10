import { Button } from "@/shared/ui";
import { MessageCircleMore } from "lucide-react";
import type { AiSurfaceAdapter, AiSuggestedAction } from "./types";

export function AiContextBar({ context }: { context: ReturnType<AiSurfaceAdapter["getContext"]> }) {
  if (!context.length) return null;
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-charcoal-border/70 px-3 py-1.5 [scrollbar-width:none]">
      <span className="shrink-0 text-[10px] font-medium text-cream-muted">Context</span>
      {context.map((item) => (
        <span
          key={`${item.kind}:${item.id}`}
          className="shrink-0 rounded-full border border-charcoal-border bg-charcoal-bg px-2 py-1 text-[10px] text-cream-muted"
          title={`${item.privacy} context`}
        >
          {item.title}
        </span>
      ))}
    </div>
  );
}

export function AiDrawerWelcome({
  label,
  actions,
  onAction,
}: {
  label: string;
  actions: AiSuggestedAction[];
  onAction: (action: AiSuggestedAction) => void;
}) {
  return (
    <div className="grid min-h-60 place-items-center text-center">
      <div className="max-w-64">
        <MessageCircleMore className="mx-auto size-5 text-cream-muted" />
        <h3 className="mb-0 mt-3 text-sm font-medium">Work with Misty here</h3>
        <p className="mb-4 mt-1 text-xs text-cream-muted">
          Misty starts with the visible {label.toLocaleLowerCase()} context. You can review any
          proposed change before it is applied.
        </p>
        {actions.length ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {actions.slice(0, 5).map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
