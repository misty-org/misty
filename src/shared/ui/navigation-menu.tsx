import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import {
  cloneElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "./utils";
import {
  TreeBranch,
  navigationTreeBranchClass,
  navigationTreeGroupClass,
  navigationTreeIconClass,
  navigationTreeRowClass,
  navigationTreeSurfaceClass,
} from "./tree-branch";

export const navigationMenuGroupClass = navigationTreeGroupClass;
export const navigationMenuPrimaryLayoutClass =
  "grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5";
export const navigationMenuPrimaryIconClass =
  "flex size-[18px] shrink-0 items-center justify-center [&_[data-app-icon]]:!size-[18px] [&_svg]:!size-[18px] [&_img]:!size-[18px]";

const focusClass =
  "focus-visible:underline focus-visible:decoration-cream-muted focus-visible:underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-cream-muted";
const iconClass = navigationTreeIconClass;

/** One row rhythm and permanently visible action treatment for the navigator. */
export const navigationMenuRowClass =
  "misty-navigator-row-target box-border h-8 min-w-0 rounded-md border-0 bg-transparent text-left text-[13px] font-medium tracking-normal text-cream-muted no-underline transition-none hover:bg-charcoal-card hover:text-cream-bright";
export const navigationMenuActionClass =
  "misty-navigator-icon-target grid size-8 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted opacity-100 visible focus-visible:underline focus-visible:decoration-cream-muted focus-visible:underline-offset-4 outline-none hover:bg-charcoal-card hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-cream-muted";
// A disclosure belongs to its row's surface, including when that row is selected.
export const navigationMenuDisclosureActionClass = `${navigationMenuActionClass} !w-6 !bg-transparent`;
export const navigationMenuDisclosureLayoutClass =
  "grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 px-2.5";
export const navigationMenuLinkClass = `${navigationMenuRowClass} ${navigationMenuPrimaryLayoutClass} px-2.5 ${focusClass}`;

export function NavigationChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      data-chevron-placement="inline"
      className={cn(
        "size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );
}

/** Shared disclosure trigger for application and settings navigation. */
export const NavigationSectionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: ReactNode;
    label: string;
    open: boolean;
  }
>(({ icon, label, open, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-expanded={open}
    data-reorder-handle="true"
    data-reorder-header="true"
    data-misty-window-drag-block="true"
    {...props}
    className={cn(
      navigationMenuRowClass,
      "w-full",
      navigationMenuDisclosureLayoutClass,
      focusClass,
      className,
    )}
  >
    <span className={cn(iconClass, navigationMenuPrimaryIconClass)}>{icon}</span>
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{label}</span>
      <NavigationChevron open={open} />
    </span>
  </button>
));
NavigationSectionButton.displayName = "NavigationSectionButton";

/** Shared destination row; asChild retains real links and their navigation behavior. */
export const NavigationTreeItem = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    children?: ReactElement;
    icon: ReactNode;
    label: string;
    selected: boolean;
    last?: boolean;
    nested?: boolean;
    settings?: boolean;
    action?: ReactNode;
    disclosure?: { open: boolean; onActivate: () => void; controls: string };
  }
>(
  (
    {
      asChild,
      children,
      icon,
      label,
      selected,
      last,
      nested = true,
      settings,
      action,
      disclosure,
      className,
      ...props
    },
    ref,
  ) => {
    if (disclosure && asChild && children) {
      return (
        <div
          className={cn(
            navigationTreeRowClass,
            "h-8 min-w-0",
            "font-medium text-cream-muted",
            selected && "text-cream-bright",
            className,
          )}
          data-selected={selected ? "true" : undefined}
        >
          {nested ? <TreeBranch className={navigationTreeBranchClass} last={last} /> : null}
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            {...props}
            type="button"
            data-tree-row-surface="true"
            data-reorder-preview="true"
            data-reorder-handle="true"
            data-misty-window-drag-block="true"
            aria-label={label}
            aria-current={selected ? "page" : undefined}
            title={`${label} · Drag to reorder · Alt+Shift+↑/↓`}
            aria-expanded={disclosure.open}
            aria-controls={disclosure.controls}
            onClick={disclosure.onActivate}
            className={cn(
              navigationTreeSurfaceClass,
              "text-inherit",
              focusClass,
              icon == null && "grid-cols-[minmax(0,1fr)] gap-0",
            )}
          >
            {icon != null && <span className={iconClass}>{icon}</span>}
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate text-left">{label}</span>
              <NavigationChevron open={disclosure.open} />
            </span>
          </button>
        </div>
      );
    }
    if (action && asChild && children) {
      return (
        <div
          className={cn(
            navigationTreeRowClass,
            "h-8 min-w-0",
            "font-medium text-cream-muted",
            selected && "text-cream-bright",
            className,
          )}
          data-selected={selected ? "true" : undefined}
        >
          {nested ? <TreeBranch className={navigationTreeBranchClass} last={last} /> : null}
          <div
            data-tree-row-surface="true"
            data-reorder-preview="true"
            className={cn(navigationTreeSurfaceClass, "flex gap-0 !p-0")}
          >
            <Slot
              ref={ref}
              {...props}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "grid h-full min-w-0 flex-1 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-md pl-2 text-inherit no-underline",
                focusClass,
              )}
            >
              {cloneElement(
                children,
                {},
                <>
                  {icon != null && <span className={iconClass}>{icon}</span>}
                  <span className="min-w-0 truncate text-left">{label}</span>
                </>,
              )}
            </Slot>
            {action}
          </div>
        </div>
      );
    }
    const content = (
      <>
        {nested ? <TreeBranch className={navigationTreeBranchClass} last={last} /> : null}
        <span
          data-tree-row-surface="true"
          data-reorder-preview="true"
          data-settings-nav-surface={settings ? "true" : undefined}
          className={cn(
            navigationTreeSurfaceClass,
            icon == null && "grid-cols-[minmax(0,1fr)] gap-0",
          )}
        >
          {icon != null && <span className={iconClass}>{icon}</span>}
          <span className="min-w-0 truncate text-left">{label}</span>
        </span>
      </>
    );
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        {...(!asChild ? { type: "button" as const } : {})}
        {...props}
        aria-current={selected ? "page" : undefined}
        className={cn(
          navigationTreeRowClass,
          "misty-navigator-row-target ml-[27px] h-8 min-w-0 bg-transparent no-underline transition-none hover:text-cream-bright",
          "font-medium text-cream-muted",
          focusClass,
          !nested && "mx-0",
          selected && "text-cream-bright",
          className,
        )}
      >
        {asChild && children ? cloneElement(children, {}, content) : content}
      </Comp>
    );
  },
);
NavigationTreeItem.displayName = "NavigationTreeItem";
