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

const focusClass = "outline-none focus-visible:ring-2 focus-visible:ring-cream-muted";
const iconClass = navigationTreeIconClass;

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
    {...props}
    className={cn(
      "misty-navigator-row-target box-border h-8 w-full rounded-md border-0 bg-transparent px-2.5 text-left text-[13px] font-medium tracking-normal text-cream-muted transition-none hover:bg-charcoal-card hover:text-cream-bright",
      navigationMenuPrimaryLayoutClass,
      focusClass,
      className,
    )}
  >
    <span className={cn(iconClass, navigationMenuPrimaryIconClass)}>{icon}</span>
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRight
        aria-hidden="true"
        data-chevron-placement="inline"
        className={cn(
          "size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
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
      className,
      ...props
    },
    ref,
  ) => {
    const content = (
      <>
        {nested ? <TreeBranch className={navigationTreeBranchClass} last={last} /> : null}
        <span
          data-tree-row-surface="true"
          data-settings-nav-surface={settings ? "true" : undefined}
          className={navigationTreeSurfaceClass}
        >
          <span className={iconClass}>{icon}</span>
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
          // 10px row padding + 9px icon radius = 19px parent center.
          // Child inset 27px minus the 8px branch offset lands on that center.
          navigationTreeRowClass,
          "misty-navigator-row-target ml-[27px] h-7 min-w-0 bg-transparent font-medium text-cream-muted no-underline transition-none hover:text-cream-bright",
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
