import type { LucideIcon } from "lucide-react";
import { cn } from "../classNames";
import { Button } from "../controls/Button";

/** The one button an empty or error state may offer. */
export type EmptyStateAction = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  /**
   * Defaults to `primary`: an empty state's button is the surface's call to action. `secondary`
   * when the surface already has its primary button elsewhere.
   */
  variant?: "primary" | "secondary";
  disabled?: boolean;
  /** Working on the click: the label stays and a spinner takes the icon's place. */
  loading?: boolean;
};

/** An empty state: centered in its pane, a title, one muted line and at most one button. */
export type EmptyStateProps = {
  title: string;
  /** The one muted line under the title. Leave it out when the title says it all. */
  line?: string;
  action?: EmptyStateAction;
  /**
   * Sits in the flow instead of filling the pane: inside a dialog, a list or a section, with its
   * own room above and below. Don't wrap it in a sized box.
   */
  inline?: boolean;
};

function PaneState({
  title,
  line,
  action,
  inline = false,
  role,
}: Pick<EmptyStateProps, "title" | "line" | "action" | "inline"> & { role?: "alert" }) {
  return (
    <div
      data-slot="empty-state"
      data-inline={inline || undefined}
      role={role}
      className={cn(
        "grid min-w-0 place-items-center overflow-hidden",
        inline ? "w-full px-4 py-8" : "size-full min-h-0 p-6",
      )}
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <h2 className="text-page font-semibold text-cream-bright text-balance">{title}</h2>
        {line ? <p className="mt-1 text-body text-cream-muted text-balance">{line}</p> : null}
        {action ? (
          <Button
            type="button"
            size="lg"
            variant={action.variant ?? "primary"}
            icon={action.icon}
            disabled={action.disabled}
            loading={action.loading}
            onClick={action.onClick}
            className="mt-5"
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Says a pane has nothing in it yet, centered in that pane: a title, one muted line, and one
 * button when there is something to do about it.
 *
 * `<EmptyState title="No notes yet" line="Notes you write here are shared with the Space."
 *   action={{ label: "New note", icon: Plus, onClick: create }} />`
 *
 * Inside a dialog, a list or a section, pass `inline` so it takes only the room it needs.
 */
function EmptyState(props: EmptyStateProps) {
  return <PaneState {...props} />;
}

/** Says a pane couldn't load, with the same shape as EmptyState; offer `{ label: "Try again" }`. */
function ErrorState(props: EmptyStateProps) {
  return <PaneState role="alert" {...props} />;
}

export { EmptyState, ErrorState };
