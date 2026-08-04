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
      <div className="group/sidebar-page flex min-h-7 min-w-0 items-center gap-1 px-2">
        <Link
          className={cn(
            "min-w-0 flex-1 truncate rounded-sm text-xs font-semibold no-underline outline-none",
            "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            props.active
              ? "text-sidebar-accent-foreground"
              : "text-muted-foreground hover:text-sidebar-accent-foreground",
          )}
          to={props.to}
          aria-current={props.active ? "page" : undefined}
        >
          {props.label}
          {typeof props.count === "number" && props.count > 0 ? (
            <span className="font-medium text-muted-foreground"> - {props.count}</span>
          ) : null}
        </Link>
        {props.action}
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-auto shrink-0 p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-sidebar-accent-foreground"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${props.label}`}
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        </Button>
      </div>
      {expanded ? <div id={contentId}>{props.children}</div> : null}
    </section>
  );
}
