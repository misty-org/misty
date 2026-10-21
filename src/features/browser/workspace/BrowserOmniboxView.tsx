import { blankBrowserUrl } from "@/features/workspace/model";
import { isNewTabOverrideUrl } from "@/features/workspace/browserHome";
import { cn, Input } from "@/shared/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The address bar at rest. It only shows where the page lives: focusing it, clicking it or
 * pressing ⌘L opens the shared search panel over the field, where all typing happens.
 */
export function BrowserOmniboxView(props: {
  currentUrl: string;
  focusRequest?: number;
  /** Opens the shared search panel where the field sits. */
  onOpenPanel: (field: DOMRect) => void;
  /** A control at the field's end, such as the bookmark star. */
  trailing?: ReactNode;
  /** Sits inside the field's left edge, as the site-info button does. */
  leading?: ReactNode;
  /** Show just the site for secure pages, as the sidebar's compact field does. */
  hostOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const trailingRef = useRef<HTMLDivElement | null>(null);
  const [trailingWidth, setTrailingWidth] = useState(0);

  const openPanel = () => {
    if (!formRef.current) return;
    props.onOpenPanel(formRef.current.getBoundingClientRect());
    inputRef.current?.blur();
  };

  useEffect(() => {
    if (props.focusRequest) openPanel();
    // Only a new request opens the panel; the opener is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusRequest]);

  useLayoutEffect(() => {
    const element = trailingRef.current;
    if (!element) {
      setTrailingWidth(0);
      return;
    }
    const measure = () => setTrailingWidth(element.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.trailing]);

  return (
    <div className="relative min-w-0 flex-1" style={{ height: 36 }}>
      <form
        ref={formRef}
        className="relative z-50 min-w-0 flex-1"
        onSubmit={(event) => event.preventDefault()}
      >
        <Input
          ref={inputRef}
          readOnly
          value={props.hostOnly ? hostAddress(props.currentUrl) : toolbarAddress(props.currentUrl)}
          onFocus={openPanel}
          onPointerDown={(event) => {
            event.preventDefault();
            openPanel();
          }}
          aria-label="Search or enter address"
          aria-haspopup="dialog"
          autoComplete="off"
          spellCheck={false}
          variant="address"
          style={props.trailing && trailingWidth ? { paddingRight: trailingWidth + 8 } : undefined}
          className={cn(
            "h-9",
            "rounded-lg px-3 text-left text-sm",
            props.trailing && "pr-10",
            props.leading && "pl-9",
          )}
        />
        {props.leading ? (
          <div className="absolute inset-y-0 left-1 flex items-center">{props.leading}</div>
        ) : null}
        {props.trailing ? (
          <div ref={trailingRef} className="absolute inset-y-0 right-1 flex items-center">
            {props.trailing}
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** The full address at rest, protocol included, so where a page lives is never hidden. */
function toolbarAddress(value: string): string {
  return value === blankBrowserUrl || isNewTabOverrideUrl(value) ? "Search or enter URL" : value;
}

/** A secure page's site without protocol, www or path; anything else keeps its full address. */
export function hostAddress(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.replace(/^www\./, "");
  } catch {
    /* Not a URL: show it as it is. */
  }
  return toolbarAddress(value);
}
