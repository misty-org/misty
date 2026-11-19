// Misty: OpenCut's ContextMenu is Misty's.
export {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuGroup,
	ContextMenuLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/shared/ui";
export { OpencutMenuItem as ContextMenuItem } from "./menu-item";

import { forwardRef, type ComponentProps, type ElementRef } from "react";
import { ContextMenuContent as MistyContextMenuContent } from "@/shared/ui";

/** OpenCut can hand a menu the element to open inside (its full-screen preview); Misty's menus
 * always open over the window, so that element is not used. */
export const ContextMenuContent = forwardRef<
	ElementRef<typeof MistyContextMenuContent>,
	ComponentProps<typeof MistyContextMenuContent> & { container?: HTMLElement | null }
>(({ container: _container, ...props }, ref) => <MistyContextMenuContent ref={ref} {...props} />);
ContextMenuContent.displayName = "ContextMenuContent";
