import * as React from "react";

/**
 * Tooltips are the operating system's own: a short `title`. These primitives keep the old
 * Tooltip / TooltipTrigger / TooltipContent composition working, but draw nothing themselves.
 * The text inside TooltipContent becomes the trigger's native `title`.
 */
type TooltipState = { title: string; setTitle: (title: string) => void };
const TooltipContext = React.createContext<TooltipState | null>(null);

/** Plain text of a node, for a native title. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

const TooltipProvider = ({
  children,
}: {
  children?: React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}) => <>{children}</>;

const Tooltip = ({ children }: { children?: React.ReactNode }) => {
  const [title, setTitle] = React.useState("");
  const value = React.useMemo(() => ({ title, setTitle }), [title]);
  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
};

/** The element a tooltip describes; with `asChild`, its child takes the native title. */
const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ asChild, children, ...props }, ref) => {
  const title = React.useContext(TooltipContext)?.title ?? "";
  if (asChild && React.isValidElement<{ title?: string }>(children))
    return React.cloneElement(children, {
      ...props,
      title: children.props.title ?? (title || undefined),
    } as Partial<{ title?: string }>);
  return (
    <button ref={ref} type="button" title={title || undefined} {...props}>
      {children}
    </button>
  );
});
TooltipTrigger.displayName = "TooltipTrigger";

/** Draws nothing: its text is handed to the trigger as the native title. */
function TooltipContent({
  children,
}: {
  children?: React.ReactNode;
  side?: string;
  sideOffset?: number;
  collisionPadding?: number;
  className?: string;
}) {
  const setTitle = React.useContext(TooltipContext)?.setTitle;
  const text = textOf(children).trim();
  React.useEffect(() => {
    setTitle?.(text);
  }, [setTitle, text]);
  return null;
}

/** A native title on one element. */
function TooltipHint({
  children,
  content,
}: {
  children: React.ReactElement<{ title?: string }>;
  content: React.ReactNode;
}) {
  const text = textOf(content).trim();
  return React.cloneElement(children, { title: children.props.title ?? (text || undefined) });
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TooltipHint };
