import { Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { controlFrame } from "./controlFrame";
import { IconButton } from "./IconButton";

type SearchFieldProps = Omit<React.ComponentProps<"input">, "size" | "type"> & {
  /**
   * Layout only (width, flex, margins) for the field's frame; `className` goes to the text box
   * inside it. Its height and corners are the shared field frame's and never change.
   */
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
 * Misty's one search box: a filled field with no hairline, in the same 32px frame as the selects,
 * buttons and chips beside it, so a bar of them lines up. It brightens under the pointer and takes
 * a soft neutral edge while typing in it. A clear button shows once there is text, and Escape
 * clears it too.
 */
const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, containerClassName, onClear, onKeyDown, ...props }, ref) => {
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
          controlFrame.md,
          // The clear button sits nearer the end than text would.
          "pl-2.5 pr-1",
          "group/search flex min-w-0 items-center gap-2 text-cream-muted",
          "border border-transparent bg-cream/5 transition-colors",
          "hover:bg-cream/8 focus-within:border-cream/14 focus-within:bg-cream/8",
          props.disabled && "pointer-events-none opacity-50",
          containerClassName,
        )}
      >
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 transition-colors group-focus-within/search:text-cream"
        />
        <input
          ref={inner}
          type="search"
          autoComplete="off"
          spellCheck={false}
          data-slot="search-field-input"
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-control text-cream-bright outline-none",
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
            size="sm"
            variant="quiet"
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
