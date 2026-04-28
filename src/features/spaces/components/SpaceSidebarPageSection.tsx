import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, cn } from "@/ui";

export function SpaceSidebarPageSection(props: {
  active: boolean;
  label: string;
  to: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(props.active);

  useEffect(() => {
    if (props.active) setExpanded(true);
  }, [props.active]);

  return (
    <section className="grid gap-1">
      <div className="group/sidebar-page flex min-h-7 min-w-0 items-center gap-1 px-1.5">
        <Link
          className={cn(
            "min-w-0 truncate rounded-sm text-xs font-semibold no-underline outline-none",
            "focus-visible:ring-2 focus-visible:ring-charcoal-active",
            props.active ? "text-cream-bright" : "text-cream-muted hover:text-cream-bright",
          )}
          to={props.to}
          aria-current={props.active ? "page" : undefined}
        >
          {props.label}
          {typeof props.count === "number" && props.count > 0 ? (
            <span className="font-medium text-cream-muted"> - {props.count}</span>
          ) : null}
        </Link>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-auto shrink-0 p-0 text-cream-muted shadow-none hover:bg-transparent hover:text-cream-bright"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${props.label}`}
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        </Button>
        <span className="flex-1" />
        {props.action}
      </div>
      {expanded ? <div id={contentId}>{props.children}</div> : null}
    </section>
  );
}
