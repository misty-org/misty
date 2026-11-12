import { Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { IconButton } from "./IconButton";

type SearchFieldProps = Omit<React.ComponentProps<"input">, "size" | "type"> & {
  /** `sm` sits in a page's top bar; `md` stands on its own in a page or section. */
  size?: "sm" | "md";
  /** Classes for the field's frame; `className` goes to the text box inside it. */
  containerClassName?: string;
  /** Clears the search. Without it, clearing empties the box through its own `onChange`. */
  onClear?: () => void;
};

/** Sets a React-controlled input's text as if typed, so its own `onChange` sees the change. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Misty's one search box: a filled field with no hairline, cornered like the buttons beside it.
 * It brightens under the pointer and takes a soft neutral ring while typing in it. A clear button
 * shows once there is text, and Escape clears it too.
 */
const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ size = "sm", className, containerClassName, onClear, onKeyDown, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    const filled = props.value !== undefined ? String(props.value) !== "" : undefined;
    const clear = () => {
      if (onClear) onClear();
      else if (inner.current) typeInto(inner.current, "");
      inner.current?.focus();
    };
    return (
      <div
        role="search"
        data-slot="search-field"
        className={cn(
          "group/search flex min-w-0 items-center gap-2 rounded-md text-cream-muted",
          "bg-cream/[0.055] ring-1 ring-transparent transition-[background-color,box-shadow]",
          "hover:bg-cream/[0.075] focus-within:bg-cream/[0.08] focus-within:ring-cream/[0.14]",
          size === "sm" ? "h-8 pl-2.5 pr-1" : "h-9 pl-3 pr-1.5",
          props.disabled && "pointer-events-none opacity-50",
          containerClassName,
        )}
      >
        <Search
          aria-hidden="true"
          className={cn(
            "shrink-0 transition-colors group-focus-within/search:text-cream",
            size === "sm" ? "size-3.5" : "size-4",
          )}
        />
        <input
          ref={inner}
          type="search"
          autoComplete="off"
          spellCheck={false}
          data-slot="search-field-input"
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-ui text-cream-bright outline-none",
            "placeholder:text-cream-muted [&::-webkit-search-cancel-button]:appearance-none",
            className,
          )}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== "Escape" || !event.currentTarget.value)
              return;
            event.preventDefault();
            event.stopPropagation();
            clear();
          }}
          {...props}
        />
        {filled ? (
          <IconButton
            size="xs"
            label="Clear search"
            className="shrink-0"
            // Keeps the caret in the box while it clears.
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <X />
          </IconButton>
        ) : (
          <span aria-hidden="true" className="w-1 shrink-0" />
        )}
      </div>
    );
  },
);
SearchField.displayName = "SearchField";

export { SearchField };
