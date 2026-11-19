// Misty: OpenCut's Popover is Misty's. Misty's popovers come in fixed widths and kinds, so the
// width and padding OpenCut gives one through its class name pick the nearest of them instead.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import {
	Popover,
	PopoverAnchor,
	PopoverClose,
	PopoverContent as MistyPopoverContent,
	PopoverTrigger,
} from "@/shared/ui";

type MistyProps = ComponentPropsWithoutRef<typeof MistyPopoverContent>;

const PopoverContent = forwardRef<
	ElementRef<typeof MistyPopoverContent>,
	MistyProps & { className?: string }
>(({ className = "", ...props }, ref) => {
	const flush = /(^|\s)p-0(\s|$)/.test(className);
	const wide = /(^|\s)(w-80|w-96|w-\[3|w-\[4|w-\[5|w-\[6)/.test(className);
	const narrow = /(^|\s)(w-56|w-60|w-48|w-52)(\s|$)/.test(className);
	return (
		<MistyPopoverContent
			ref={ref}
			kind={props.kind ?? (flush ? "flush" : "panel")}
			size={props.size ?? (wide ? "lg" : narrow ? "sm" : "md")}
			{...props}
		/>
	);
});
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
