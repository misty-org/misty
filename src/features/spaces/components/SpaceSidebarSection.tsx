import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button, cn } from "@/ui";

export function SpaceSidebarSection({
  title,
  count,
  icon,
  action,
  children,
  className,
  collapsible,
  defaultExpanded = true,
}: {
  title?: string;
  count?: number;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) {
  const contentId = useId();
  const canCollapse = collapsible ?? Boolean(title);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentVisible = !canCollapse || expanded;

  return (
    <section className={cn("grid gap-1", className)}>
      {title || action ? (
        <div className="group/sidebar-header flex min-h-7 items-center gap-1 px-2">
          {title && canCollapse ? (
            <Button
              type="button"
              variant="ghost"
              className={[
                "h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-left text-xs shadow-none",
                "font-semibold text-cream-muted hover:bg-transparent hover:text-cream-bright",
              ].join(" ")}
              aria-controls={contentId}
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {icon ? <span className="shrink-0">{icon}</span> : null}
              <span className="min-w-0 flex-1 truncate">
                {title}
                {typeof count === "number" && count > 0 ? (
                  <span className="text-cream-muted/80"> - {count}</span>
                ) : null}
              </span>
              <ChevronRight
                size={13}
                className={cn("ml-auto shrink-0 transition-transform", expanded && "rotate-90")}
              />
            </Button>
          ) : title ? (
            <h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold text-cream-muted">
              {title}
            </h2>
          ) : (
            <span className="flex-1" />
          )}
          {action}
        </div>
      ) : null}
      {contentVisible ? <div id={contentId}>{children}</div> : null}
    </section>
  );
}
