import type { ElementType, HTMLAttributes } from "react";
import { cn } from "../classNames";
import "./pageEnter.css";

export type PageEnterProps = HTMLAttributes<HTMLElement> & {
  /** The element drawn; a `div` unless the content is a heading or a footer. */
  as?: ElementType;
};

/**
 * Content that fades and rises into place as a page opens, such as a signed-out page's form or a
 * setup step's title. Give it a `key` that changes to play it again. `className` is for layout.
 *
 * ```tsx
 * <PageEnter key={title} className="flex flex-col gap-8">{form}</PageEnter>
 * ```
 */
export function PageEnter({ as: Tag = "div", className, ...props }: PageEnterProps) {
  return <Tag data-slot="page-enter" className={cn("misty-page-in", className)} {...props} />;
}
